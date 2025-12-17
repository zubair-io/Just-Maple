//
//  NativeBridge.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import Foundation
import WebKit

// MARK: - Message Types

enum WebToNativeMessage: Codable {
    case test(TestPayload)
    case startRecording
    case stopRecording
    case cancelRecording
    case getServerList
    case getActiveServer
    case setActiveServer(SetActiveServerPayload)
    case validateServer(ValidateServerPayload)
    case addServer(AddServerPayload)
    case removeServer(RemoveServerPayload)
    case saveToken(SaveTokenPayload)
    case getToken(GetTokenPayload?)
    case clearToken(ClearTokenPayload?)
    case requestPushPermission
    case unregisterPushNotifications
    case getPushStatus
    case unknown

    struct TestPayload: Codable {
        let message: String
        let timestamp: String
    }

    struct SetActiveServerPayload: Codable {
        let serverId: String
    }

    struct ValidateServerPayload: Codable {
        let url: String
    }

    struct AddServerPayload: Codable {
        let name: String
        let url: String
        let apiUrl: String?
    }

    struct RemoveServerPayload: Codable {
        let serverId: String
    }

    struct SaveTokenPayload: Codable {
        let token: String
        let serverId: String?
    }

    struct GetTokenPayload: Codable {
        let serverId: String?
    }

    struct ClearTokenPayload: Codable {
        let serverId: String?
    }

    enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "test":
            let payload = try container.decode(TestPayload.self, forKey: .payload)
            self = .test(payload)
        case "startRecording":
            self = .startRecording
        case "stopRecording":
            self = .stopRecording
        case "cancelRecording":
            self = .cancelRecording
        case "getServerList":
            self = .getServerList
        case "getActiveServer":
            self = .getActiveServer
        case "setActiveServer":
            let payload = try container.decode(SetActiveServerPayload.self, forKey: .payload)
            self = .setActiveServer(payload)
        case "validateServer":
            let payload = try container.decode(ValidateServerPayload.self, forKey: .payload)
            self = .validateServer(payload)
        case "addServer":
            let payload = try container.decode(AddServerPayload.self, forKey: .payload)
            self = .addServer(payload)
        case "removeServer":
            let payload = try container.decode(RemoveServerPayload.self, forKey: .payload)
            self = .removeServer(payload)
        case "saveToken":
            let payload = try container.decode(SaveTokenPayload.self, forKey: .payload)
            self = .saveToken(payload)
        case "getToken":
            let payload = try? container.decode(GetTokenPayload.self, forKey: .payload)
            self = .getToken(payload)
        case "clearToken":
            let payload = try? container.decode(ClearTokenPayload.self, forKey: .payload)
            self = .clearToken(payload)
        case "requestPushPermission":
            self = .requestPushPermission
        case "unregisterPushNotifications":
            self = .unregisterPushNotifications
        case "getPushStatus":
            self = .getPushStatus
        default:
            self = .unknown
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .test(let payload):
            try container.encode("test", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .startRecording:
            try container.encode("startRecording", forKey: .type)
        case .stopRecording:
            try container.encode("stopRecording", forKey: .type)
        case .cancelRecording:
            try container.encode("cancelRecording", forKey: .type)
        case .getServerList:
            try container.encode("getServerList", forKey: .type)
        case .getActiveServer:
            try container.encode("getActiveServer", forKey: .type)
        case .setActiveServer(let payload):
            try container.encode("setActiveServer", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .validateServer(let payload):
            try container.encode("validateServer", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .addServer(let payload):
            try container.encode("addServer", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .removeServer(let payload):
            try container.encode("removeServer", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .saveToken(let payload):
            try container.encode("saveToken", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .getToken(let payload):
            try container.encode("getToken", forKey: .type)
            if let payload = payload {
                try container.encode(payload, forKey: .payload)
            }
        case .clearToken(let payload):
            try container.encode("clearToken", forKey: .type)
            if let payload = payload {
                try container.encode(payload, forKey: .payload)
            }
        case .requestPushPermission:
            try container.encode("requestPushPermission", forKey: .type)
        case .unregisterPushNotifications:
            try container.encode("unregisterPushNotifications", forKey: .type)
        case .getPushStatus:
            try container.encode("getPushStatus", forKey: .type)
        case .unknown:
            try container.encode("unknown", forKey: .type)
        }
    }
}

enum NativeToWebMessage {
    case initialize(InitialState)
    case testResponse(TestResponse)
    case recordingStarted(RecordingStarted)
    case recordingStopped(RecordingStopped)
    case recordingCancelled
    case audioLevel(AudioLevel)
    case transcriptionProgress(TranscriptionProgress)
    case transcriptionComplete(TranscriptionComplete)
    case serverList(ServerListResponse)
    case activeServer(ActiveServerResponse)
    case serverValidationResult(ServerValidationResponse)
    case tokenSaved(TokenSavedResponse)
    case currentToken(CurrentTokenResponse)
    case tokenCleared(TokenClearedResponse)
    case pushPermissionResult(PushPermissionResponse)
    case pushUnregistered(PushUnregisteredResponse)
    case pushStatus(PushStatusResponse)
    case notificationTapped(NotificationTapped)
    case deepLink(DeepLinkPayload)
    case error(ErrorMessage)

    struct InitialState: Codable {
        let appVersion: String
        let platform: String
        let timestamp: String
        let serverUrl: String
        let serverName: String
    }

    struct TestResponse: Codable {
        let success: Bool
        let message: String
        let receivedAt: String
    }

    struct RecordingStarted: Codable {
        let filePath: String
        let timestamp: String
    }

    struct RecordingStopped: Codable {
        let filePath: String
        let duration: Double
        let timestamp: String
    }

    struct AudioLevel: Codable {
        let level: Float
        let duration: Double
    }

    struct TranscriptionProgress: Codable {
        let text: String
        let progress: Double
    }

    struct TranscriptionComplete: Codable {
        let text: String
        let duration: Double
        let segments: [TranscriptSegmentPayload]?
    }

    struct TranscriptSegmentPayload: Codable {
        let speaker: String
        let text: String
        let startTime: Double
        let endTime: Double
    }

    struct ErrorMessage: Codable {
        let code: String
        let message: String
    }

    struct ServerListResponse: Codable {
        let servers: [ServerInfo]

        struct ServerInfo: Codable {
            let id: String
            let name: String
            let url: String
            let apiUrl: String?
            let isCustom: Bool
        }
    }

    struct ActiveServerResponse: Codable {
        let id: String
        let name: String
        let url: String
        let apiUrl: String?
        let isCustom: Bool
    }

    struct ServerValidationResponse: Codable {
        let url: String
        let isValid: Bool
        let error: String?
    }

    struct TokenSavedResponse: Codable {
        let success: Bool
    }

    struct CurrentTokenResponse: Codable {
        let token: String?
    }

    struct TokenClearedResponse: Codable {
        let success: Bool
    }

    struct PushPermissionResponse: Codable {
        let granted: Bool
        let error: String?
    }

    struct PushUnregisteredResponse: Codable {
        let success: Bool
        let error: String?
    }

    struct PushStatusResponse: Codable {
        let isRegistered: Bool
        let serverKey: String?
    }

    struct NotificationTapped: Codable {
        let notificationId: String
        let type: String
        let apiUrl: String
    }

    struct DeepLinkPayload: Codable {
        let url: String
    }

    enum CodingKeys: String, CodingKey {
        case type
        case payload
    }
}

extension NativeToWebMessage: Encodable {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .initialize(let state):
            try container.encode("initialize", forKey: .type)
            try container.encode(state, forKey: .payload)
        case .testResponse(let response):
            try container.encode("testResponse", forKey: .type)
            try container.encode(response, forKey: .payload)
        case .recordingStarted(let payload):
            try container.encode("recordingStarted", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .recordingStopped(let payload):
            try container.encode("recordingStopped", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .recordingCancelled:
            try container.encode("recordingCancelled", forKey: .type)
        case .audioLevel(let payload):
            try container.encode("audioLevel", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .transcriptionProgress(let payload):
            try container.encode("transcriptionProgress", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .transcriptionComplete(let payload):
            try container.encode("transcriptionComplete", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .serverList(let payload):
            try container.encode("serverList", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .activeServer(let payload):
            try container.encode("activeServer", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .serverValidationResult(let payload):
            try container.encode("serverValidationResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .tokenSaved(let payload):
            try container.encode("tokenSaved", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .currentToken(let payload):
            try container.encode("currentToken", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .tokenCleared(let payload):
            try container.encode("tokenCleared", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .pushPermissionResult(let payload):
            try container.encode("pushPermissionResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .pushUnregistered(let payload):
            try container.encode("pushUnregistered", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .pushStatus(let payload):
            try container.encode("pushStatus", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .notificationTapped(let payload):
            try container.encode("notificationTapped", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .deepLink(let payload):
            try container.encode("deepLink", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .error(let payload):
            try container.encode("error", forKey: .type)
            try container.encode(payload, forKey: .payload)
        }
    }
}

// MARK: - Native Bridge

class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var audioLevelTask: Task<Void, Never>?

    init(webView: WKWebView?) {
        self.webView = webView
        super.init()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    // MARK: - Receive from Web

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8) else {
            print("[Bridge] Invalid message format")
            return
        }

        do {
            let message = try decoder.decode(WebToNativeMessage.self, from: data)
            print("[Bridge] Received from web: \(message)")
            Task {
                await handle(message)
            }
        } catch {
            print("[Bridge] Failed to decode message: \(error)")
        }
    }

    // MARK: - Handle Messages

    private func handle(_ message: WebToNativeMessage) async {
        let transcriptionService = TranscriptionService.shared

        #if os(macOS)
        // Use MultiTrackRecorder on macOS 13+, fallback to single-track for older versions
        if #available(macOS 13.0, *) {
            await handleWithMultiTrack(message, transcriptionService: transcriptionService)
        } else {
            await handleWithSingleTrack(message, transcriptionService: transcriptionService)
        }
        #else
        // iOS always uses single-track recording
        await handleWithSingleTrack(message, transcriptionService: transcriptionService)
        #endif
    }

    #if os(macOS)
    @available(macOS 13.0, *)
    private func handleWithMultiTrack(_ message: WebToNativeMessage, transcriptionService: TranscriptionService) async {
        let multiTrackRecorder = MultiTrackRecorder.shared

        switch message {
        case .test(let payload):
            print("[Bridge] Test message: \(payload.message)")
            send(.testResponse(NativeToWebMessage.TestResponse(
                success: true,
                message: "Received your message: \(payload.message)",
                receivedAt: ISO8601DateFormatter().string(from: Date())
            )))

        case .startRecording:
            print("[Bridge] Starting multi-track recording...")
            do {
                let paths = try await multiTrackRecorder.startRecording()
                send(.recordingStarted(NativeToWebMessage.RecordingStarted(
                    filePath: paths.micPath.path,
                    timestamp: ISO8601DateFormatter().string(from: Date())
                )))

                // Start sending audio levels in a cancellable task
                audioLevelTask = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                        guard !Task.isCancelled else { break }
                        // Send average of both audio levels
                        let avgLevel = (multiTrackRecorder.micAudioLevel + multiTrackRecorder.systemAudioLevel) / 2
                        self?.send(.audioLevel(NativeToWebMessage.AudioLevel(
                            level: avgLevel,
                            duration: multiTrackRecorder.recordingDuration
                        )))
                    }
                }
            } catch {
                send(.error(NativeToWebMessage.ErrorMessage(
                    code: "RECORDING_ERROR",
                    message: error.localizedDescription
                )))
            }

        case .stopRecording:
            print("[Bridge] Stopping multi-track recording...")

            // Cancel the audio level task
            audioLevelTask?.cancel()
            audioLevelTask = nil

            do {
                let result = try await multiTrackRecorder.stopRecording()
                send(.recordingStopped(NativeToWebMessage.RecordingStopped(
                    filePath: result.micPath.path,
                    duration: result.duration,
                    timestamp: ISO8601DateFormatter().string(from: Date())
                )))

                // Start multi-track transcription
                print("[Bridge] Starting multi-track transcription...")
                do {
                    let transcription = try await transcriptionService.transcribeMultiTrack(
                        micAudioURL: result.micPath,
                        systemAudioURL: result.systemPath,
                        startTime: result.startTime
                    ) { progress in
                        self.send(.transcriptionProgress(NativeToWebMessage.TranscriptionProgress(
                            text: progress,
                            progress: 0.5
                        )))
                    }

                    // Convert segments to payload
                    let segmentPayloads = transcription.segments.map { segment in
                        NativeToWebMessage.TranscriptSegmentPayload(
                            speaker: segment.speaker.rawValue,
                            text: segment.text,
                            startTime: segment.startTime,
                            endTime: segment.endTime
                        )
                    }

                    send(.transcriptionComplete(NativeToWebMessage.TranscriptionComplete(
                        text: transcription.toFormattedText(),
                        duration: result.duration,
                        segments: segmentPayloads
                    )))
                } catch {
                    send(.error(NativeToWebMessage.ErrorMessage(
                        code: "TRANSCRIPTION_ERROR",
                        message: error.localizedDescription
                    )))
                }
            } catch {
                send(.error(NativeToWebMessage.ErrorMessage(
                    code: "STOP_RECORDING_ERROR",
                    message: error.localizedDescription
                )))
            }

        case .cancelRecording:
            print("[Bridge] Cancelling multi-track recording...")

            // Cancel the audio level task
            audioLevelTask?.cancel()
            audioLevelTask = nil

            await multiTrackRecorder.cancelRecording()
            send(.recordingCancelled)

        case .getServerList:
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .getActiveServer:
            let server = ServerConfigService.shared.getActiveServer()
            send(.activeServer(NativeToWebMessage.ActiveServerResponse(
                id: server.id,
                name: server.name,
                url: server.url,
                apiUrl: server.apiUrl,
                isCustom: server.isCustom
            )))

        case .setActiveServer(let payload):
            ServerConfigService.shared.setActiveServer(id: payload.serverId)
            let server = ServerConfigService.shared.getActiveServer()

            // Navigate to root of new server
            if let newURL = URL(string: server.url) {
                DispatchQueue.main.async { [weak self] in
                    let request = URLRequest(url: newURL)
                    self?.webView?.load(request)
                }
            }

            send(.activeServer(NativeToWebMessage.ActiveServerResponse(
                id: server.id,
                name: server.name,
                url: server.url,
                apiUrl: server.apiUrl,
                isCustom: server.isCustom
            )))

        case .validateServer(let payload):
            do {
                let isValid = try await ServerConfigService.shared.validateServer(url: payload.url)
                send(.serverValidationResult(NativeToWebMessage.ServerValidationResponse(
                    url: payload.url,
                    isValid: isValid,
                    error: nil
                )))
            } catch {
                send(.serverValidationResult(NativeToWebMessage.ServerValidationResponse(
                    url: payload.url,
                    isValid: false,
                    error: error.localizedDescription
                )))
            }

        case .addServer(let payload):
            let server = ServerConfigService.ServerConfig(
                name: payload.name,
                url: payload.url,
                apiUrl: payload.apiUrl,
                isCustom: true
            )
            ServerConfigService.shared.addServer(server)
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .removeServer(let payload):
            ServerConfigService.shared.removeServer(id: payload.serverId)
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .saveToken(let payload):
            let success = ServerConfigService.shared.saveToken(payload.token, serverId: payload.serverId)
            send(.tokenSaved(NativeToWebMessage.TokenSavedResponse(success: success)))

        case .getToken(let payload):
            let token = ServerConfigService.shared.getToken(serverId: payload?.serverId)
            send(.currentToken(NativeToWebMessage.CurrentTokenResponse(token: token)))

        case .clearToken(let payload):
            let success = ServerConfigService.shared.clearToken(serverId: payload?.serverId)
            send(.tokenCleared(NativeToWebMessage.TokenClearedResponse(success: success)))

        case .requestPushPermission:
            Task {
                do {
                    let activeServer = ServerConfigService.shared.getActiveServer()
                    try await PushNotificationService.shared.requestPermissionsAndRegister(serverId: activeServer.id) { [weak self] success, error in
                        // This completion is called after device token arrives and API registration completes
                        self?.send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                            granted: success,
                            error: error?.localizedDescription
                        )))
                    }
                } catch {
                    // This catch handles immediate failures (e.g., permission denied before device token)
                    send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                        granted: false,
                        error: error.localizedDescription
                    )))
                }
            }

        case .unregisterPushNotifications:
            Task {
                do {
                    // Unregister from all servers
                    try await PushNotificationService.shared.unregister()
                    send(.pushUnregistered(NativeToWebMessage.PushUnregisteredResponse(
                        success: true,
                        error: nil
                    )))
                } catch {
                    send(.pushUnregistered(NativeToWebMessage.PushUnregisteredResponse(
                        success: false,
                        error: error.localizedDescription
                    )))
                }
            }

        case .getPushStatus:
            let serverKey = PushNotificationService.shared.getServerKey()
            send(.pushStatus(NativeToWebMessage.PushStatusResponse(
                isRegistered: serverKey != nil,
                serverKey: serverKey
            )))

        case .unknown:
            print("[Bridge] Unknown message type")
        }
    }
    #endif // os(macOS)

    private func handleWithSingleTrack(_ message: WebToNativeMessage, transcriptionService: TranscriptionService) async {
        let audioRecorder = AudioRecorderService.shared

        switch message {
        case .test(let payload):
            print("[Bridge] Test message: \(payload.message)")
            send(.testResponse(NativeToWebMessage.TestResponse(
                success: true,
                message: "Received your message: \(payload.message)",
                receivedAt: ISO8601DateFormatter().string(from: Date())
            )))

        case .startRecording:
            print("[Bridge] Starting recording...")
            do {
                let filePath = try await audioRecorder.startRecording()
                send(.recordingStarted(NativeToWebMessage.RecordingStarted(
                    filePath: filePath.path,
                    timestamp: ISO8601DateFormatter().string(from: Date())
                )))

                // Start sending audio levels in a cancellable task
                audioLevelTask = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                        guard !Task.isCancelled else { break }
                        self?.send(.audioLevel(NativeToWebMessage.AudioLevel(
                            level: audioRecorder.audioLevel,
                            duration: audioRecorder.recordingDuration
                        )))
                    }
                }
            } catch {
                send(.error(NativeToWebMessage.ErrorMessage(
                    code: "RECORDING_ERROR",
                    message: error.localizedDescription
                )))
            }

        case .stopRecording:
            print("[Bridge] Stopping recording...")

            // Cancel the audio level task
            audioLevelTask?.cancel()
            audioLevelTask = nil

            do {
                let result = try await audioRecorder.stopRecording()
                send(.recordingStopped(NativeToWebMessage.RecordingStopped(
                    filePath: result.path.path,
                    duration: result.duration,
                    timestamp: ISO8601DateFormatter().string(from: Date())
                )))

                // Start transcription
                print("[Bridge] Starting transcription...")
                do {
                    let transcription = try await transcriptionService.transcribe(
                        audioFileURL: result.path
                    ) { progress in
                        self.send(.transcriptionProgress(NativeToWebMessage.TranscriptionProgress(
                            text: progress,
                            progress: 0.5
                        )))
                    }

                    send(.transcriptionComplete(NativeToWebMessage.TranscriptionComplete(
                        text: transcription,
                        duration: result.duration,
                        segments: nil
                    )))
                } catch {
                    send(.error(NativeToWebMessage.ErrorMessage(
                        code: "TRANSCRIPTION_ERROR",
                        message: error.localizedDescription
                    )))
                }
            } catch {
                send(.error(NativeToWebMessage.ErrorMessage(
                    code: "STOP_RECORDING_ERROR",
                    message: error.localizedDescription
                )))
            }

        case .cancelRecording:
            print("[Bridge] Cancelling recording...")

            // Cancel the audio level task
            audioLevelTask?.cancel()
            audioLevelTask = nil

            await audioRecorder.cancelRecording()
            send(.recordingCancelled)

        case .getServerList:
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .getActiveServer:
            let server = ServerConfigService.shared.getActiveServer()
            send(.activeServer(NativeToWebMessage.ActiveServerResponse(
                id: server.id,
                name: server.name,
                url: server.url,
                apiUrl: server.apiUrl,
                isCustom: server.isCustom
            )))

        case .setActiveServer(let payload):
            ServerConfigService.shared.setActiveServer(id: payload.serverId)
            let server = ServerConfigService.shared.getActiveServer()

            // Navigate to root of new server
            if let newURL = URL(string: server.url) {
                DispatchQueue.main.async { [weak self] in
                    let request = URLRequest(url: newURL)
                    self?.webView?.load(request)
                }
            }

            send(.activeServer(NativeToWebMessage.ActiveServerResponse(
                id: server.id,
                name: server.name,
                url: server.url,
                apiUrl: server.apiUrl,
                isCustom: server.isCustom
            )))

        case .validateServer(let payload):
            do {
                let isValid = try await ServerConfigService.shared.validateServer(url: payload.url)
                send(.serverValidationResult(NativeToWebMessage.ServerValidationResponse(
                    url: payload.url,
                    isValid: isValid,
                    error: nil
                )))
            } catch {
                send(.serverValidationResult(NativeToWebMessage.ServerValidationResponse(
                    url: payload.url,
                    isValid: false,
                    error: error.localizedDescription
                )))
            }

        case .addServer(let payload):
            let server = ServerConfigService.ServerConfig(
                name: payload.name,
                url: payload.url,
                apiUrl: payload.apiUrl,
                isCustom: true
            )
            ServerConfigService.shared.addServer(server)
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .removeServer(let payload):
            ServerConfigService.shared.removeServer(id: payload.serverId)
            let servers = ServerConfigService.shared.getServers()
            let serverInfos = servers.map { server in
                NativeToWebMessage.ServerListResponse.ServerInfo(
                    id: server.id,
                    name: server.name,
                    url: server.url,
                    apiUrl: server.apiUrl,
                    isCustom: server.isCustom
                )
            }
            send(.serverList(NativeToWebMessage.ServerListResponse(servers: serverInfos)))

        case .saveToken(let payload):
            let success = ServerConfigService.shared.saveToken(payload.token, serverId: payload.serverId)
            send(.tokenSaved(NativeToWebMessage.TokenSavedResponse(success: success)))

        case .getToken(let payload):
            let token = ServerConfigService.shared.getToken(serverId: payload?.serverId)
            send(.currentToken(NativeToWebMessage.CurrentTokenResponse(token: token)))

        case .clearToken(let payload):
            let success = ServerConfigService.shared.clearToken(serverId: payload?.serverId)
            send(.tokenCleared(NativeToWebMessage.TokenClearedResponse(success: success)))

        #if os(iOS)
        case .requestPushPermission:
            Task {
                do {
                    let activeServer = ServerConfigService.shared.getActiveServer()
                    try await PushNotificationService.shared.requestPermissionsAndRegister(serverId: activeServer.id) { [weak self] success, error in
                        // This completion is called after device token arrives and API registration completes
                        self?.send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                            granted: success,
                            error: error?.localizedDescription
                        )))
                    }
                } catch {
                    // This catch handles immediate failures (e.g., permission denied before device token)
                    send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                        granted: false,
                        error: error.localizedDescription
                    )))
                }
            }

        case .unregisterPushNotifications:
            Task {
                do {
                    // Unregister from all servers
                    try await PushNotificationService.shared.unregister()
                    send(.pushUnregistered(NativeToWebMessage.PushUnregisteredResponse(
                        success: true,
                        error: nil
                    )))
                } catch {
                    send(.pushUnregistered(NativeToWebMessage.PushUnregisteredResponse(
                        success: false,
                        error: error.localizedDescription
                    )))
                }
            }

        case .getPushStatus:
            let serverKey = PushNotificationService.shared.getServerKey()
            send(.pushStatus(NativeToWebMessage.PushStatusResponse(
                isRegistered: serverKey != nil,
                serverKey: serverKey
            )))
        #else
        case .requestPushPermission, .unregisterPushNotifications, .getPushStatus:
            print("[Bridge] Push notifications not supported on macOS")
        #endif

        case .unknown:
            print("[Bridge] Unknown message type")
        }
    }

    // MARK: - Send to Web

    func send(_ message: NativeToWebMessage) {
        guard let webView = webView else {
            print("[Bridge] WebView not available")
            return
        }

        do {
            let data = try encoder.encode(message)
            guard let json = String(data: data, encoding: .utf8) else {
                print("[Bridge] Failed to convert data to string")
                return
            }

            let js = "window.__nativeBridge__.receive(\(json))"

            DispatchQueue.main.async {
                webView.evaluateJavaScript(js) { _, error in
                    if let error = error {
                        print("[Bridge] JS eval error: \(error)")
                    } else {
                        print("[Bridge] Sent to web: \(message)")
                    }
                }
            }
        } catch {
            print("[Bridge] Failed to encode message: \(error)")
        }
    }

    func sendInitialize() {
        let activeServer = ServerConfigService.shared.getActiveServer()

        #if os(iOS)
        let platform = "iOS"
        #elseif os(macOS)
        let platform = "macOS"
        #else
        let platform = "unknown"
        #endif

        let initialState = NativeToWebMessage.InitialState(
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
            platform: platform,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            serverUrl: activeServer.url,
            serverName: activeServer.name
        )
        send(.initialize(initialState))
    }

    func sendDeepLink(url: String) {
        send(.deepLink(NativeToWebMessage.DeepLinkPayload(url: url)))
    }

    func handleNotificationTap(notificationId: String, type: String, apiUrl: String) {
        send(.notificationTapped(NativeToWebMessage.NotificationTapped(
            notificationId: notificationId,
            type: type,
            apiUrl: apiUrl
        )))
    }
}
