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

export interface OpenAuthSessionPayload {
  url: string;
  callbackScheme: string;
  callbackURL?: string;
}

export interface GmailOAuthResultPayload {
  code?: string;
  state?: string;
  error?: string;
}

export interface StartRecordingPayload {
  includeSystemAudio?: boolean;
}

// MARK: - File System Payloads

export interface ListFilesPayload {
  path: string;
  extension?: string;
}

export interface ReadFilePayload {
  path: string;
}

export interface WriteFilePayload {
  path: string;
  content: string;
}

export interface DeleteFilePayload {
  path: string;
}

export interface ShareFilePayload {
  filename: string;
  mimeType: string;
  data: string; // base64-encoded file content
}

// MARK: - API Request Payloads

export interface ApiRequestPayload {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ApiResponsePayload {
  requestId: string;
  status: number;
  statusText: string;
  durationMs: number;
  body: string; // JSON string
  headers?: Record<string, string>;
}

export type WebToNativeMessageType =
  | { type: 'test'; payload: TestPayload }
  | { type: 'startRecording'; payload?: StartRecordingPayload }
  | { type: 'stopRecording' }
  | { type: 'cancelRecording' }
  | { type: 'saveToken'; payload: SaveTokenPayload }
  | { type: 'getToken'; payload?: GetTokenPayload }
  | { type: 'clearToken'; payload?: ClearTokenPayload }
  | { type: 'requestPushPermission' }
  | { type: 'getPushStatus' }
  | { type: 'unregisterPushNotifications' }
  | { type: 'setBadge'; payload: SetBadgePayload }
  | { type: 'openFolderPicker' }
  | { type: 'listFiles'; payload: ListFilesPayload }
  | { type: 'readFile'; payload: ReadFilePayload }
  | { type: 'writeFile'; payload: WriteFilePayload }
  | { type: 'deleteFile'; payload: DeleteFilePayload }
  | { type: 'openAuthSession'; payload: OpenAuthSessionPayload }
  | { type: 'gmailOAuthResult'; payload: GmailOAuthResultPayload }
  | { type: 'shareFile'; payload: ShareFilePayload }
  | { type: 'apiRequest'; payload: ApiRequestPayload }
  | { type: 'getICloudContainerPath' }
  | { type: 'sidebarActiveChanged'; payload: SidebarActiveChangedPayload }
  | { type: 'sidebarDataChanged'; payload: SidebarDataChangedPayload }
  | { type: 'sidebarUnreadCounts'; payload: SidebarUnreadCountsPayload }
  | { type: 'toggleNativeSidebar' };

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
  /** When true, the native app renders its own sidebar and the web sidebar should be hidden */
  hasNativeSidebar?: boolean;
  /** Deep link URL if the app was opened via a universal link (e.g., email sign-in) */
  initialDeepLink?: string;
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
  audioData?: string; // Base64-encoded audio file data
  mimeType?: string;
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

export interface AuthSessionResult {
  url?: string;
  error?: string;
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
  notebookId?: string;
  messageId?: string;
}

export interface ForegroundNotification {
  notificationId: string;
  type: string;
  apiUrl: string;
  notebookId?: string;
  messageId?: string;
}

// MARK: - File System Response Types

export interface FolderPickerResult {
  path: string | null;
  name?: string;
}

export interface FileListResult {
  files: Array<{
    name: string;
    path: string;
    lastModified?: string;
  }>;
  error?: string;
}

export interface FileReadResult {
  content?: string;
  error?: string;
}

export interface FileWriteResult {
  success: boolean;
  error?: string;
}

export interface FileDeleteResult {
  success: boolean;
  error?: string;
}

export interface ICloudContainerPathResult {
  path: string | null;
  folders: Array<{ name: string; path: string }>;
}

// MARK: - Native Sidebar Payloads (Native → Web)

export interface SidebarNavigatePayload {
  notebookId: string;
  pageId?: string;
}

export interface SidebarPageCreatedPayload {
  page: {
    id: string;
    title: string;
    type: string;
    notebookId: string;
    [key: string]: unknown;
  };
}

export interface SidebarPageTrashedPayload {
  pageId: string;
}

export interface SidebarPageRenamedPayload {
  pageId: string;
  title: string;
}

export interface SidebarPageMovedPayload {
  pageId: string;
  notebookId: string;
}

export interface SidebarNotebookCreatedPayload {
  notebook: {
    _id: string;
    label: string;
    [key: string]: unknown;
  };
}

export interface SidebarNotebookRenamedPayload {
  notebookId: string;
  label: string;
}

export interface SidebarNotebookDeletedPayload {
  notebookId: string;
}

export interface SidebarNewPagePayload {
  notebookId: string;
  type: string;
}

// MARK: - Native Sidebar Payloads (Web → Native)

export interface SidebarActiveChangedPayload {
  notebookId?: string;
  pageId?: string;
}

export interface SidebarDataChangedPayload {
  entity: 'page' | 'notebook';
  action: 'created' | 'updated' | 'deleted';
  id: string;
}

export interface SidebarUnreadCountsPayload {
  counts: Array<{ pageId: string; count: number }>;
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
  | { type: 'tokenSaved'; payload: TokenSavedResponse }
  | { type: 'currentToken'; payload: CurrentTokenResponse }
  | { type: 'tokenCleared'; payload: TokenClearedResponse }
  | { type: 'pushPermissionResult'; payload: PushPermissionResponse }
  | { type: 'pushUnregistered'; payload: PushUnregisteredResponse }
  | { type: 'pushStatus'; payload: PushStatusResponse }
  | { type: 'notificationTapped'; payload: NotificationTapped }
  | { type: 'foregroundNotification'; payload: ForegroundNotification }
  | { type: 'deepLink'; payload: DeepLinkPayload }
  | { type: 'folderPickerResult'; payload: FolderPickerResult }
  | { type: 'fileListResult'; payload: FileListResult }
  | { type: 'fileReadResult'; payload: FileReadResult }
  | { type: 'fileWriteResult'; payload: FileWriteResult }
  | { type: 'fileDeleteResult'; payload: FileDeleteResult }
  | { type: 'authSessionResult'; payload: AuthSessionResult }
  | { type: 'apiResponse'; payload: ApiResponsePayload }
  | { type: 'icloudContainerPath'; payload: ICloudContainerPathResult }
  | { type: 'sidebarNavigate'; payload: SidebarNavigatePayload }
  | { type: 'sidebarPageCreated'; payload: SidebarPageCreatedPayload }
  | { type: 'sidebarPageTrashed'; payload: SidebarPageTrashedPayload }
  | { type: 'sidebarPageRenamed'; payload: SidebarPageRenamedPayload }
  | { type: 'sidebarPageMoved'; payload: SidebarPageMovedPayload }
  | { type: 'sidebarNotebookCreated'; payload: SidebarNotebookCreatedPayload }
  | { type: 'sidebarNotebookRenamed'; payload: SidebarNotebookRenamedPayload }
  | { type: 'sidebarNotebookDeleted'; payload: SidebarNotebookDeletedPayload }
  | { type: 'sidebarNewPage'; payload: SidebarNewPagePayload }
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
