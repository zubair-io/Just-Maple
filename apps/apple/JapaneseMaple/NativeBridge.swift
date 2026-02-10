//
//  NativeBridge.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import Foundation
import WebKit
import AuthenticationServices

// MARK: - Message Types

enum WebToNativeMessage: Codable {
    case test(TestPayload)
    case startRecording(StartRecordingPayload?)
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
    case setBadge(SetBadgePayload)
    case openAuthSession(OpenAuthSessionPayload)
    case openFolderPicker
    case listFiles(ListFilesPayload)
    case readFile(ReadFilePayload)
    case writeFile(WriteFilePayload)
    case deleteFile(DeleteFilePayload)
    case unknown

    struct TestPayload: Codable {
        let message: String
        let timestamp: String
    }

    struct StartRecordingPayload: Codable {
        let includeSystemAudio: Bool?
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

    struct SetBadgePayload: Codable {
        let count: Int
    }

    struct OpenAuthSessionPayload: Codable {
        let url: String
        let callbackScheme: String
    }

    struct ListFilesPayload: Codable {
        let path: String
        let `extension`: String?
    }

    struct ReadFilePayload: Codable {
        let path: String
    }

    struct WriteFilePayload: Codable {
        let path: String
        let content: String
    }

    struct DeleteFilePayload: Codable {
        let path: String
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
            let payload = try? container.decode(StartRecordingPayload.self, forKey: .payload)
            self = .startRecording(payload)
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
        case "setBadge":
            let payload = try container.decode(SetBadgePayload.self, forKey: .payload)
            self = .setBadge(payload)
        case "openAuthSession":
            let payload = try container.decode(OpenAuthSessionPayload.self, forKey: .payload)
            self = .openAuthSession(payload)
        case "openFolderPicker":
            self = .openFolderPicker
        case "listFiles":
            let payload = try container.decode(ListFilesPayload.self, forKey: .payload)
            self = .listFiles(payload)
        case "readFile":
            let payload = try container.decode(ReadFilePayload.self, forKey: .payload)
            self = .readFile(payload)
        case "writeFile":
            let payload = try container.decode(WriteFilePayload.self, forKey: .payload)
            self = .writeFile(payload)
        case "deleteFile":
            let payload = try container.decode(DeleteFilePayload.self, forKey: .payload)
            self = .deleteFile(payload)
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
        case .startRecording(let payload):
            try container.encode("startRecording", forKey: .type)
            if let payload = payload {
                try container.encode(payload, forKey: .payload)
            }
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
        case .setBadge(let payload):
            try container.encode("setBadge", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .openAuthSession(let payload):
            try container.encode("openAuthSession", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .openFolderPicker:
            try container.encode("openFolderPicker", forKey: .type)
        case .listFiles(let payload):
            try container.encode("listFiles", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .readFile(let payload):
            try container.encode("readFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .writeFile(let payload):
            try container.encode("writeFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .deleteFile(let payload):
            try container.encode("deleteFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
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
    case foregroundNotification(ForegroundNotification)
    case deepLink(DeepLinkPayload)
    case authSessionResult(AuthSessionResult)
    case folderPickerResult(FolderPickerResult)
    case fileListResult(FileListResult)
    case fileReadResult(FileReadResult)
    case fileWriteResult(FileWriteResult)
    case fileDeleteResult(FileDeleteResult)
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
        let audioData: String? // Base64-encoded audio file data
        let mimeType: String?
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
        let serverId: String?
    }

    struct NotificationTapped: Codable {
        let notificationId: String
        let type: String
        let apiUrl: String
        let tagId: String?
        let messageId: String?
    }

    struct ForegroundNotification: Codable {
        let notificationId: String
        let type: String
        let apiUrl: String
        let tagId: String?
        let messageId: String?
    }

    struct DeepLinkPayload: Codable {
        let url: String
    }

    struct AuthSessionResult: Codable {
        let url: String?
        let error: String?
    }

    struct FolderPickerResult: Codable {
        let path: String?
        let name: String?
    }

    struct FileListResult: Codable {
        let files: [FileInfo]
        let error: String?

        struct FileInfo: Codable {
            let name: String
            let path: String
            let lastModified: String?
        }
    }

    struct FileReadResult: Codable {
        let content: String?
        let error: String?
    }

    struct FileWriteResult: Codable {
        let success: Bool
        let error: String?
    }

    struct FileDeleteResult: Codable {
        let success: Bool
        let error: String?
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
        case .foregroundNotification(let payload):
            try container.encode("foregroundNotification", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .deepLink(let payload):
            try container.encode("deepLink", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .authSessionResult(let payload):
            try container.encode("authSessionResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .folderPickerResult(let payload):
            try container.encode("folderPickerResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileListResult(let payload):
            try container.encode("fileListResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileReadResult(let payload):
            try container.encode("fileReadResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileWriteResult(let payload):
            try container.encode("fileWriteResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileDeleteResult(let payload):
            try container.encode("fileDeleteResult", forKey: .type)
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
    private var authSession: ASWebAuthenticationSession?
    private var folderPickerObserver: NSObjectProtocol?
    /// Security-scoped folder URLs granted by the user via folder picker.
    /// Must be kept alive so file operations within these folders are allowed by the sandbox.
    private var grantedFolderURLs: [URL] = []

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

        case .startRecording(let payload):
            let includeSystemAudio = payload?.includeSystemAudio ?? false
            print("[Bridge] Starting multi-track recording... (system audio: \(includeSystemAudio))")
            do {
                let paths = try await multiTrackRecorder.startRecording(includeSystemAudio: includeSystemAudio)
                send(.recordingStarted(NativeToWebMessage.RecordingStarted(
                    filePath: paths.micPath.path,
                    timestamp: ISO8601DateFormatter().string(from: Date())
                )))

                // Start sending audio levels in a cancellable task
                audioLevelTask = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
                        guard !Task.isCancelled else { break }
                        // Send mic level only, or average if system audio is enabled
                        let level = includeSystemAudio
                            ? (multiTrackRecorder.micAudioLevel + multiTrackRecorder.systemAudioLevel) / 2
                            : multiTrackRecorder.micAudioLevel
                        self?.send(.audioLevel(NativeToWebMessage.AudioLevel(
                            level: level,
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

                // Read audio file and convert to base64 for upload
                var audioData: String? = nil
                var mimeType: String? = nil
                if let audioFileData = try? Data(contentsOf: result.micPath) {
                    audioData = audioFileData.base64EncodedString()
                    mimeType = "audio/mp4" // m4a files use audio/mp4 MIME type
                    print("[Bridge] Read audio file: \(audioFileData.count) bytes")
                }

                send(.recordingStopped(NativeToWebMessage.RecordingStopped(
                    filePath: result.micPath.path,
                    duration: result.duration,
                    timestamp: ISO8601DateFormatter().string(from: Date()),
                    audioData: audioData,
                    mimeType: mimeType
                )))

                // Use multi-track transcription if system audio was recorded, otherwise single-track
                if result.includesSystemAudio, let systemPath = result.systemPath {
                    print("[Bridge] Starting multi-track transcription...")
                    do {
                        let transcription = try await transcriptionService.transcribeMultiTrack(
                            micAudioURL: result.micPath,
                            systemAudioURL: systemPath,
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
                } else {
                    // Single-track transcription (mic only)
                    print("[Bridge] Starting single-track transcription...")
                    do {
                        let transcription = try await transcriptionService.transcribe(
                            audioFileURL: result.micPath
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
            if success {
                // Sync token to Apple Watch
                #if os(iOS)
                WatchConnectivityService.shared.syncAuthToken()
                #endif
            }
            send(.tokenSaved(NativeToWebMessage.TokenSavedResponse(success: success)))

        case .getToken(let payload):
            let token = ServerConfigService.shared.getToken(serverId: payload?.serverId)
            send(.currentToken(NativeToWebMessage.CurrentTokenResponse(token: token)))

        case .clearToken(let payload):
            let success = ServerConfigService.shared.clearToken(serverId: payload?.serverId)
            if success {
                // Clear token from Apple Watch
                #if os(iOS)
                WatchConnectivityService.shared.clearAuthToken()
                #endif
            }
            send(.tokenCleared(NativeToWebMessage.TokenClearedResponse(success: success)))

        case .requestPushPermission:
            Task {
                let activeServer = ServerConfigService.shared.getActiveServer()
                do {
                    try await PushNotificationService.shared.requestPermissionsAndRegister(serverId: activeServer.id) { [weak self] success, error in
                        // This completion is called after device token arrives and API registration completes
                        DispatchQueue.main.async {
                            self?.send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                                granted: success,
                                error: error?.localizedDescription
                            )))
                        }
                    }
                    // If we get here without throwing, permission was granted and we're waiting for device token
                    // Response will be sent via the completion handler above
                    print("[Bridge] ✅ Permission granted, waiting for device token and API registration...")
                } catch {
                    // This catch handles immediate failures (e.g., permission denied before device token)
                    print("[Bridge] ❌ Permission request failed immediately: \(error)")
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
            let activeServer = ServerConfigService.shared.getActiveServer()
            let isRegistered = PushNotificationService.shared.isServerRegistered(serverId: activeServer.id)
            send(.pushStatus(NativeToWebMessage.PushStatusResponse(
                isRegistered: isRegistered,
                serverId: isRegistered ? activeServer.id : nil
            )))

        case .setBadge(let payload):
            // macOS doesn't have app icon badges like iOS
            print("[Bridge] Badge not supported on macOS (requested: \(payload.count))")

        case .openAuthSession(let payload):
            Task { @MainActor in
                self.startAuthSession(payload: payload)
            }

        case .openFolderPicker:
            Task { @MainActor in
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                panel.message = "Choose a folder to open"

                let response = panel.runModal()
                if response == .OK, let url = panel.url {
                    // Start accessing the security-scoped resource and store the URL
                    // so file operations within this folder are permitted by the sandbox
                    let didStart = url.startAccessingSecurityScopedResource()
                    if didStart {
                        print("[Bridge] Started accessing security-scoped resource: \(url.path)")
                    }
                    self.grantedFolderURLs.removeAll { $0.path == url.path }
                    self.grantedFolderURLs.append(url)

                    self.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: url.path,
                        name: url.lastPathComponent
                    )))
                } else {
                    self.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: nil,
                        name: nil
                    )))
                }
            }

        case .listFiles(let payload):
            handleListFiles(payload)

        case .readFile(let payload):
            handleReadFile(payload)

        case .writeFile(let payload):
            handleWriteFile(payload)

        case .deleteFile(let payload):
            handleDeleteFile(payload)

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

        case .startRecording(_):
            // Single-track always uses mic only (system audio requires macOS 13+)
            print("[Bridge] Starting recording (mic only)...")
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

                // Read audio file and convert to base64 for upload
                var audioData: String? = nil
                var mimeType: String? = nil
                if let audioFileData = try? Data(contentsOf: result.path) {
                    audioData = audioFileData.base64EncodedString()
                    mimeType = "audio/mp4" // m4a files use audio/mp4 MIME type
                    print("[Bridge] Read audio file: \(audioFileData.count) bytes")
                }

                send(.recordingStopped(NativeToWebMessage.RecordingStopped(
                    filePath: result.path.path,
                    duration: result.duration,
                    timestamp: ISO8601DateFormatter().string(from: Date()),
                    audioData: audioData,
                    mimeType: mimeType
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
            if success {
                // Sync token to Apple Watch
                #if os(iOS)
                WatchConnectivityService.shared.syncAuthToken()
                #endif
            }
            send(.tokenSaved(NativeToWebMessage.TokenSavedResponse(success: success)))

        case .getToken(let payload):
            let token = ServerConfigService.shared.getToken(serverId: payload?.serverId)
            send(.currentToken(NativeToWebMessage.CurrentTokenResponse(token: token)))

        case .clearToken(let payload):
            let success = ServerConfigService.shared.clearToken(serverId: payload?.serverId)
            if success {
                // Clear token from Apple Watch
                #if os(iOS)
                WatchConnectivityService.shared.clearAuthToken()
                #endif
            }
            send(.tokenCleared(NativeToWebMessage.TokenClearedResponse(success: success)))

        #if os(iOS)
        case .requestPushPermission:
            Task {
                let activeServer = ServerConfigService.shared.getActiveServer()
                do {
                    try await PushNotificationService.shared.requestPermissionsAndRegister(serverId: activeServer.id) { [weak self] success, error in
                        // This completion is called after device token arrives and API registration completes
                        DispatchQueue.main.async {
                            self?.send(.pushPermissionResult(NativeToWebMessage.PushPermissionResponse(
                                granted: success,
                                error: error?.localizedDescription
                            )))
                        }
                    }
                    // If we get here without throwing, permission was granted and we're waiting for device token
                    // Response will be sent via the completion handler above
                    print("[Bridge] ✅ Permission granted, waiting for device token and API registration...")
                } catch {
                    // This catch handles immediate failures (e.g., permission denied before device token)
                    print("[Bridge] ❌ Permission request failed immediately: \(error)")
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
            let activeServer = ServerConfigService.shared.getActiveServer()
            let isRegistered = PushNotificationService.shared.isServerRegistered(serverId: activeServer.id)
            send(.pushStatus(NativeToWebMessage.PushStatusResponse(
                isRegistered: isRegistered,
                serverId: isRegistered ? activeServer.id : nil
            )))

        case .setBadge(let payload):
            Task { @MainActor in
                UIApplication.shared.applicationIconBadgeNumber = payload.count
                print("[Bridge] Set app badge to \(payload.count)")
            }
        #else
        case .requestPushPermission, .unregisterPushNotifications, .getPushStatus:
            print("[Bridge] Push notifications not supported on macOS")

        case .setBadge(let payload):
            print("[Bridge] Badge not supported on macOS (requested: \(payload.count))")
        #endif

        case .openAuthSession(let payload):
            Task { @MainActor in
                self.startAuthSession(payload: payload)
            }

        case .openFolderPicker:
            #if os(iOS)
            // Post notification for ContentView to present folder picker
            Task { @MainActor in
                // Remove previous observer if any
                if let prev = self.folderPickerObserver {
                    NotificationCenter.default.removeObserver(prev)
                    self.folderPickerObserver = nil
                }

                // Listen for result before posting request
                let observer = NotificationCenter.default.addObserver(
                    forName: NSNotification.Name("FolderPickerResult"),
                    object: nil,
                    queue: .main
                ) { [weak self] notification in
                    // Remove observer after receiving result
                    if let obs = self?.folderPickerObserver {
                        NotificationCenter.default.removeObserver(obs)
                        self?.folderPickerObserver = nil
                    }

                    let path = notification.userInfo?["path"] as? String
                    let name = notification.userInfo?["name"] as? String

                    // Store the security-scoped URL for later file operations
                    if let url = notification.userInfo?["url"] as? URL {
                        self?.grantedFolderURLs.removeAll { $0.path == url.path }
                        self?.grantedFolderURLs.append(url)
                    }

                    self?.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: path,
                        name: name
                    )))
                }

                self.folderPickerObserver = observer

                NotificationCenter.default.post(name: NSNotification.Name("FolderPickerRequested"), object: nil)
            }
            #else
            // macOS fallback (shouldn't reach here since macOS uses handleWithMultiTrack)
            send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(path: nil, name: nil)))
            #endif

        case .listFiles(let payload):
            handleListFiles(payload)

        case .readFile(let payload):
            handleReadFile(payload)

        case .writeFile(let payload):
            handleWriteFile(payload)

        case .deleteFile(let payload):
            handleDeleteFile(payload)

        case .unknown:
            print("[Bridge] Unknown message type")
        }
    }

    // MARK: - Auth Session

    @MainActor
    private func startAuthSession(payload: WebToNativeMessage.OpenAuthSessionPayload) {
        guard authSession == nil else {
            send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                url: nil,
                error: "Auth session already in progress"
            )))
            return
        }

        guard !payload.callbackScheme.isEmpty else {
            send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                url: nil,
                error: "Invalid callback scheme"
            )))
            return
        }

        guard let authURL = URL(string: payload.url) else {
            send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                url: nil,
                error: "Invalid auth URL"
            )))
            return
        }

        let session = ASWebAuthenticationSession(
            url: authURL,
            callbackURLScheme: payload.callbackScheme
        ) { [weak self] callbackURL, error in
            self?.authSession = nil
            if let error = error as? ASWebAuthenticationSessionError,
               error.code == .canceledLogin {
                self?.send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                    url: nil,
                    error: "User cancelled"
                )))
            } else if let error = error {
                self?.send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                    url: nil,
                    error: error.localizedDescription
                )))
            } else if let callbackURL = callbackURL {
                self?.send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                    url: callbackURL.absoluteString,
                    error: nil
                )))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.authSession = session

        if !session.start() {
            self.authSession = nil
            send(.authSessionResult(NativeToWebMessage.AuthSessionResult(
                url: nil,
                error: "Failed to start auth session"
            )))
        }
    }

    // MARK: - File System Operations

    /// Find the granted security-scoped folder URL that contains the given path.
    private func grantedFolderURL(for path: String) -> URL? {
        return grantedFolderURLs.first { folderURL in
            let folderPath = folderURL.path.hasSuffix("/") ? folderURL.path : folderURL.path + "/"
            return path.hasPrefix(folderPath) || path == folderURL.path
        }
    }

    /// Convert a path string to a URL, preferring a security-scoped URL derived
    /// from a previously granted folder when available.
    private func securityScopedURL(for path: String) -> URL {
        if let folderURL = grantedFolderURL(for: path) {
            // Build URL relative to the security-scoped folder URL so the
            // sandbox grant carries over to the child path.
            let folderPath = folderURL.path
            let relative = String(path.dropFirst(folderPath.count))
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if relative.isEmpty {
                return folderURL
            }
            return folderURL.appendingPathComponent(relative)
        }
        return URL(fileURLWithPath: path)
    }

    private func handleListFiles(_ payload: WebToNativeMessage.ListFilesPayload) {
        let fileManager = FileManager.default
        let dirURL = securityScopedURL(for: payload.path)
        do {
            let contents = try fileManager.contentsOfDirectory(
                at: dirURL,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )
            let filterExt = payload.extension

            let fileInfos: [NativeToWebMessage.FileListResult.FileInfo] = contents.compactMap { fileURL in
                let name = fileURL.lastPathComponent

                // Filter by extension if specified
                if let ext = filterExt {
                    let normalizedExt = ext.hasPrefix(".") ? ext : ".\(ext)"
                    guard name.hasSuffix(normalizedExt) else { return nil }
                }

                // Skip directories
                let resourceValues = try? fileURL.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey])
                if resourceValues?.isDirectory == true { return nil }

                // Get last modified date
                var lastModified: String? = nil
                if let modDate = resourceValues?.contentModificationDate {
                    lastModified = ISO8601DateFormatter().string(from: modDate)
                }

                return NativeToWebMessage.FileListResult.FileInfo(
                    name: name,
                    path: fileURL.path,
                    lastModified: lastModified
                )
            }

            send(.fileListResult(NativeToWebMessage.FileListResult(
                files: fileInfos,
                error: nil
            )))
        } catch {
            send(.fileListResult(NativeToWebMessage.FileListResult(
                files: [],
                error: error.localizedDescription
            )))
        }
    }

    private func handleReadFile(_ payload: WebToNativeMessage.ReadFilePayload) {
        let fileURL = securityScopedURL(for: payload.path)
        do {
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            send(.fileReadResult(NativeToWebMessage.FileReadResult(
                content: content,
                error: nil
            )))
        } catch {
            send(.fileReadResult(NativeToWebMessage.FileReadResult(
                content: nil,
                error: error.localizedDescription
            )))
        }
    }

    private func handleWriteFile(_ payload: WebToNativeMessage.WriteFilePayload) {
        let fileURL = securityScopedURL(for: payload.path)
        do {
            // Create intermediate directories if needed
            let dirURL = fileURL.deletingLastPathComponent()
            let fileManager = FileManager.default
            if !fileManager.fileExists(atPath: dirURL.path) {
                try fileManager.createDirectory(at: dirURL, withIntermediateDirectories: true)
            }

            try payload.content.write(to: fileURL, atomically: true, encoding: .utf8)
            send(.fileWriteResult(NativeToWebMessage.FileWriteResult(
                success: true,
                error: nil
            )))
        } catch {
            send(.fileWriteResult(NativeToWebMessage.FileWriteResult(
                success: false,
                error: error.localizedDescription
            )))
        }
    }

    private func handleDeleteFile(_ payload: WebToNativeMessage.DeleteFilePayload) {
        let fileURL = securityScopedURL(for: payload.path)
        do {
            try FileManager.default.removeItem(at: fileURL)
            send(.fileDeleteResult(NativeToWebMessage.FileDeleteResult(
                success: true,
                error: nil
            )))
        } catch {
            send(.fileDeleteResult(NativeToWebMessage.FileDeleteResult(
                success: false,
                error: error.localizedDescription
            )))
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

    func handleNotificationTap(notificationId: String, type: String, apiUrl: String, tagId: String? = nil, messageId: String? = nil) {
        send(.notificationTapped(NativeToWebMessage.NotificationTapped(
            notificationId: notificationId,
            type: type,
            apiUrl: apiUrl,
            tagId: tagId,
            messageId: messageId
        )))
    }

    func handleForegroundNotification(notificationId: String, type: String, apiUrl: String, tagId: String? = nil, messageId: String? = nil) {
        send(.foregroundNotification(NativeToWebMessage.ForegroundNotification(
            notificationId: notificationId,
            type: type,
            apiUrl: apiUrl,
            tagId: tagId,
            messageId: messageId
        )))
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension NativeBridge: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(iOS)
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        #else
        return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
        #endif
    }
}
