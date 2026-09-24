import Foundation
import Network
import Security

public enum CompanionFrame {
    public static let maximumLength = 256 * 1024
    public static func encode(_ payload: Data) throws -> Data {
        guard payload.count <= maximumLength else { throw CompanionTransportError.invalidFrame }
        var length = UInt32(payload.count).bigEndian
        return withUnsafeBytes(of: &length) { Data($0) } + payload
    }
    public static func length(_ header: Data) throws -> Int {
        guard header.count == 4 else { throw CompanionTransportError.invalidFrame }
        let count = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard count <= maximumLength else { throw CompanionTransportError.invalidFrame }
        return Int(count)
    }
}

func transportParameters(_ configuration: PairingConfiguration) throws -> NWParameters {
    guard configuration.secret.count == 32 else { throw CompanionTransportError.invalidConfiguration }
    let tls = NWProtocolTLS.Options()
    let options = tls.securityProtocolOptions
    // Restrict negotiation to authenticated PSK encryption; never install a trust bypass.
    // TLS 1.2 has no 0-RTT. Tickets/resumption are disabled below; pure PSK has no forward secrecy.
    sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
    sec_protocol_options_set_max_tls_protocol_version(options, .TLSv12)
    sec_protocol_options_append_tls_ciphersuite(options, tls_ciphersuite_t(rawValue: TLS_PSK_WITH_AES_128_GCM_SHA256)!)
    let key = configuration.secret.withUnsafeBytes { DispatchData(bytes: $0) }
    let identity = Data(configuration.id.uuidString.utf8).withUnsafeBytes { DispatchData(bytes: $0) }
    sec_protocol_options_add_pre_shared_key(options, key as __DispatchData, identity as __DispatchData)
    sec_protocol_options_set_tls_tickets_enabled(options, false)
    sec_protocol_options_set_tls_resumption_enabled(options, false)
    let result = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
    result.includePeerToPeer = true
    return result
}

/// All lifecycle and continuation changes are isolated to the main actor.
@MainActor private final class Exchange {
    let connection: NWConnection
    var completed = false
    var timeout: Task<Void, Never>?
    var work: Task<Void, Never>?
    var completion: ((Result<Data, Error>) -> Void)?
    init(_ connection: NWConnection) { self.connection = connection }

    func start(timeoutSeconds: Double, completion: @escaping (Result<Data, Error>) -> Void, ready: @escaping @MainActor () -> Void) {
        self.completion = completion
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, !self.completed else { return }
                switch state {
                case .ready: ready()
                case .failed(let error): self.finish(.failure(error))
                case .cancelled: self.finish(.failure(CancellationError()))
                default: break
                }
            }
        }
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(timeoutSeconds)) } catch { return }
            self?.finish(.failure(CompanionTransportError.timedOut))
        }
        connection.start(queue: .main)
    }
    func finish(_ result: Result<Data, Error>) {
        guard !completed else { return }
        completed = true
        timeout?.cancel(); work?.cancel()
        connection.stateUpdateHandler = nil
        connection.cancel()
        let callback = completion; completion = nil
        callback?(result)
    }
    func send(_ payload: Data, then: @escaping @MainActor () -> Void) {
        guard !completed else { return }
        do {
            connection.send(content: try CompanionFrame.encode(payload), completion: .contentProcessed { [weak self] error in
                Task { @MainActor in
                    guard let self, !self.completed else { return }
                    if let error { self.finish(.failure(error)) } else { then() }
                }
            })
        } catch { finish(.failure(error)) }
    }
    func receive(_ then: @escaping @MainActor (Data) -> Void) {
        read(count: 4) { [weak self] header in
            guard let self else { return }
            do {
                let count = try CompanionFrame.length(header)
                if count == 0 { then(Data()) } else { self.read(count: count, then: then) }
            } catch { self.finish(.failure(error)) }
        }
    }
    private func read(count: Int, accumulated: Data = Data(), then: @escaping @MainActor (Data) -> Void) {
        guard !completed else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: count - accumulated.count) { [weak self] data, _, complete, error in
            Task { @MainActor in
                guard let self, !self.completed else { return }
                if let error { self.finish(.failure(error)); return }
                let bytes = accumulated + (data ?? Data())
                if bytes.count == count { then(bytes) }
                else if complete { self.finish(.failure(CompanionTransportError.disconnected)) }
                else { self.read(count: count, accumulated: bytes, then: then) }
            }
        }
    }
}

@MainActor public enum CompanionTransportClient {
    public static func exchange(configuration: PairingConfiguration, payload: Data) async throws -> Data {
        try await exchange(configuration: configuration, payload: payload,
            endpoint: .service(name: configuration.serviceName.uuidString, type: "_maple-sync._tcp", domain: "local.", interface: nil))
    }
    static func exchange(configuration: PairingConfiguration, payload: Data, endpoint: NWEndpoint, timeoutSeconds: Double = 15) async throws -> Data {
        _ = try CompanionFrame.encode(payload)
        try Task.checkCancellation()
        let operation = Exchange(NWConnection(to: endpoint, using: try transportParameters(configuration)))
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                operation.start(timeoutSeconds: timeoutSeconds, completion: { continuation.resume(with: $0) }) {
                    operation.send(payload) { operation.receive { operation.finish(.success($0)) } }
                }
            }
        } onCancel: {
            Task { @MainActor in operation.finish(.failure(CancellationError())) }
        }
    }
}

@MainActor public final class CompanionTransportServer {
    private var listener: NWListener?
    private var operations: [UUID: Exchange] = [:]
    private var startup: CheckedContinuation<Void, Error>?
    private var startupTimeout: Task<Void, Never>?
    public private(set) var port: UInt16?
    public init() {}

    public func start(configuration: PairingConfiguration, handler: @escaping @MainActor @Sendable (Data) async throws -> Data) async throws {
        stop()
        try Task.checkCancellation()
        let listener = try NWListener(using: transportParameters(configuration), on: .any)
        self.listener = listener
        listener.service = .init(name: configuration.serviceName.uuidString, type: "_maple-sync._tcp", domain: "local.")
        listener.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in
                guard let self, self.listener === listener, self.operations.count < 4 else { connection.cancel(); return }
                let id = UUID()
                let operation = Exchange(connection)
                self.operations[id] = operation
                operation.start(timeoutSeconds: 15, completion: { [weak self] _ in self?.operations[id] = nil }) {
                    operation.receive { payload in
                        operation.work = Task {
                            do {
                                let response = try await handler(payload)
                                try Task.checkCancellation()
                                operation.send(response) { operation.finish(.success(Data())) }
                            } catch { operation.finish(.failure(error)) }
                        }
                    }
                }
            }
        }
        listener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.listener === listener else { return }
                switch state {
                case .ready:
                    self.port = listener.port?.rawValue
                    self.finishStartup(nil)
                case .failed(let error): self.finishStartup(error); self.stop()
                case .cancelled: self.finishStartup(CompanionTransportError.stopped)
                default: break
                }
            }
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                startup = continuation
                startupTimeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    self?.finishStartup(CompanionTransportError.timedOut); self?.stop()
                }
                listener.start(queue: .main)
            }
        } onCancel: { Task { @MainActor [weak self] in
            guard let self, self.listener === listener else { return }
            self.stop()
        } }
    }
    private func finishStartup(_ error: Error?) {
        startupTimeout?.cancel(); startupTimeout = nil
        let continuation = startup; startup = nil
        if let error { continuation?.resume(throwing: error) } else { continuation?.resume() }
    }
    public func stop() {
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel(); listener = nil; port = nil
        finishStartup(CompanionTransportError.stopped)
        let pending = Array(operations.values); operations.removeAll()
        for operation in pending { operation.finish(.failure(CompanionTransportError.stopped)) }
    }
}
