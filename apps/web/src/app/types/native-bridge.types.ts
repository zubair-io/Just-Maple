// Native Bridge TypeScript Types
// These types mirror the Swift types in JapaneseMaple/NativeBridge.swift

// MARK: - Web to Native Messages

export interface WebToNativeMessage<T = unknown> {
  type: string;
  payload?: T;
}

export interface TestPayload {
  message: string;
  timestamp: string;
}

export interface SetActiveServerPayload {
  serverId: string;
}

export interface ValidateServerPayload {
  url: string;
}

export interface AddServerPayload {
  name: string;
  url: string;
  apiUrl?: string;
}

export interface RemoveServerPayload {
  serverId: string;
}

export interface SaveTokenPayload {
  token: string;
  serverId?: string;
}

export interface GetTokenPayload {
  serverId?: string;
}

export interface ClearTokenPayload {
  serverId?: string;
}

export interface SetBadgePayload {
  count: number;
}

export type WebToNativeMessageType =
  | { type: 'test'; payload: TestPayload }
  | { type: 'startRecording' }
  | { type: 'stopRecording' }
  | { type: 'cancelRecording' }
  | { type: 'getServerList' }
  | { type: 'getActiveServer' }
  | { type: 'setActiveServer'; payload: SetActiveServerPayload }
  | { type: 'validateServer'; payload: ValidateServerPayload }
  | { type: 'addServer'; payload: AddServerPayload }
  | { type: 'removeServer'; payload: RemoveServerPayload }
  | { type: 'saveToken'; payload: SaveTokenPayload }
  | { type: 'getToken'; payload?: GetTokenPayload }
  | { type: 'clearToken'; payload?: ClearTokenPayload }
  | { type: 'requestPushPermission' }
  | { type: 'getPushStatus' }
  | { type: 'unregisterPushNotifications' }
  | { type: 'setBadge'; payload: SetBadgePayload };

// MARK: - Native to Web Messages

export interface NativeToWebMessage<T = unknown> {
  type: string;
  payload: T;
}

export interface InitialState {
  appVersion: string;
  platform: string;
  timestamp: string;
  serverUrl: string;
  serverName: string;
}

export interface TestResponse {
  success: boolean;
  message: string;
  receivedAt: string;
}

export interface RecordingStarted {
  filePath: string;
  timestamp: string;
}

export interface RecordingStopped {
  filePath: string;
  duration: number;
  timestamp: string;
}

export interface AudioLevel {
  level: number;
  duration: number;
}

export interface TranscriptionProgress {
  text: string;
  progress: number;
}

export interface TranscriptSegment {
  speaker: string; // "You" or "Other"
  text: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptionComplete {
  text: string;
  duration: number;
  segments?: TranscriptSegment[];
}

export interface ServerInfo {
  id: string;
  name: string;
  url: string;
  apiUrl?: string;
  isCustom: boolean;
}

export interface ServerListResponse {
  servers: ServerInfo[];
}

export interface ActiveServerResponse {
  id: string;
  name: string;
  url: string;
  apiUrl?: string;
  isCustom: boolean;
}

export interface ServerValidationResponse {
  url: string;
  isValid: boolean;
  error?: string;
}

export interface TokenSavedResponse {
  success: boolean;
}

export interface CurrentTokenResponse {
  token: string | null;
}

export interface TokenClearedResponse {
  success: boolean;
}

export interface DeepLinkPayload {
  url: string;
}

export interface ErrorMessage {
  code: string;
  message: string;
}

export interface PushPermissionResponse {
  granted: boolean;
  error?: string;
}

export interface PushUnregisteredResponse {
  success: boolean;
  error?: string;
}

export interface PushStatusResponse {
  isRegistered: boolean;
  serverId: string | null;
}

export interface NotificationTapped {
  notificationId: string;
  type: string;
  apiUrl: string;
  tagId?: string;
  messageId?: string;
}

export interface ForegroundNotification {
  notificationId: string;
  type: string;
  apiUrl: string;
  tagId?: string;
  messageId?: string;
}

export type NativeToWebMessageType =
  | { type: 'initialize'; payload: InitialState }
  | { type: 'testResponse'; payload: TestResponse }
  | { type: 'recordingStarted'; payload: RecordingStarted }
  | { type: 'recordingStopped'; payload: RecordingStopped }
  | { type: 'recordingCancelled' }
  | { type: 'audioLevel'; payload: AudioLevel }
  | { type: 'transcriptionProgress'; payload: TranscriptionProgress }
  | { type: 'transcriptionComplete'; payload: TranscriptionComplete }
  | { type: 'serverList'; payload: ServerListResponse }
  | { type: 'activeServer'; payload: ActiveServerResponse }
  | { type: 'serverValidationResult'; payload: ServerValidationResponse }
  | { type: 'tokenSaved'; payload: TokenSavedResponse }
  | { type: 'currentToken'; payload: CurrentTokenResponse }
  | { type: 'tokenCleared'; payload: TokenClearedResponse }
  | { type: 'pushPermissionResult'; payload: PushPermissionResponse }
  | { type: 'pushUnregistered'; payload: PushUnregisteredResponse }
  | { type: 'pushStatus'; payload: PushStatusResponse }
  | { type: 'notificationTapped'; payload: NotificationTapped }
  | { type: 'foregroundNotification'; payload: ForegroundNotification }
  | { type: 'deepLink'; payload: DeepLinkPayload }
  | { type: 'error'; payload: ErrorMessage };

// MARK: - Bridge Interface

export interface NativeBridgeInterface {
  receive: (message: NativeToWebMessage) => void;
}

declare global {
  interface Window {
    __nativeBridge__?: NativeBridgeInterface;
    webkit?: {
      messageHandlers?: {
        nativeBridge?: {
          postMessage: (message: string) => void;
        };
      };
    };
  }
}
