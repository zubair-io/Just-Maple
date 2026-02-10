import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
  NativeToWebMessage,
  WebToNativeMessageType,
  InitialState,
  ServerListResponse,
  ActiveServerResponse,
  ServerValidationResponse,
  TokenSavedResponse,
  CurrentTokenResponse,
  TokenClearedResponse,
  PushPermissionResponse,
  PushUnregisteredResponse,
  PushStatusResponse,
  NotificationTapped,
  ForegroundNotification,
  DeepLinkPayload,
  RecordingStarted,
  RecordingStopped,
  AudioLevel,
  TranscriptionProgress,
  TranscriptionComplete,
  AuthSessionResult,
  GmailOAuthResultPayload,
  ErrorMessage,
  FolderPickerResult,
  FileListResult,
  FileReadResult,
  FileWriteResult,
  FileDeleteResult,
  ApiRequestPayload,
  ApiResponsePayload,
} from '../types/native-bridge.types';

@Injectable({
  providedIn: 'root',
})
export class NativeBridgeService {
  private readonly _messages$ = new Subject<NativeToWebMessage>();
  private _isNativeApp = false;
  private _initialState: InitialState | null = null;

  // Public observables for different message types
  readonly messages$ = this._messages$.asObservable();

  constructor() {
    this.detectNativeApp();
    if (this._isNativeApp) {
      this.setupMessageReceiver();
    }
  }

  // MARK: - Detection

  private detectNativeApp(): void {
    this._isNativeApp = !!(window.webkit?.messageHandlers?.nativeBridge || window.__nativeBridge__);
  }

  isNativeApp(): boolean {
    return this._isNativeApp;
  }

  getInitialState(): InitialState | null {
    return this._initialState;
  }

  /** Returns the platform ('iOS' or 'macOS') if in native app, null otherwise */
  getPlatform(): string | null {
    return this._initialState?.platform || null;
  }

  /** Returns true if running in native macOS app */
  isMacOS(): boolean {
    return this._initialState?.platform === 'macOS';
  }

  // MARK: - Message Reception

  private setupMessageReceiver(): void {
    window.__nativeBridge__ = {
      receive: (message: NativeToWebMessage) => {
        // Store initial state
        if (message.type === 'initialize') {
          this._initialState = message.payload as InitialState;
        }

        this._messages$.next(message);
      },
    };
  }

  // MARK: - Typed Observables

  onInitialize(): Observable<InitialState> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'initialize'),
      map((msg) => msg.payload as InitialState),
    );
  }

  onServerList(): Observable<ServerListResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'serverList'),
      map((msg) => msg.payload as ServerListResponse),
    );
  }

  onActiveServer(): Observable<ActiveServerResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'activeServer'),
      map((msg) => msg.payload as ActiveServerResponse),
    );
  }

  onServerValidation(): Observable<ServerValidationResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'serverValidationResult'),
      map((msg) => msg.payload as ServerValidationResponse),
    );
  }

  onTokenSaved(): Observable<TokenSavedResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'tokenSaved'),
      map((msg) => msg.payload as TokenSavedResponse),
    );
  }

  onCurrentToken(): Observable<CurrentTokenResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'currentToken'),
      map((msg) => msg.payload as CurrentTokenResponse),
    );
  }

  onTokenCleared(): Observable<TokenClearedResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'tokenCleared'),
      map((msg) => msg.payload as TokenClearedResponse),
    );
  }

  onDeepLink(): Observable<DeepLinkPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'deepLink'),
      map((msg) => msg.payload as DeepLinkPayload),
    );
  }

  onRecordingStarted(): Observable<RecordingStarted> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'recordingStarted'),
      map((msg) => msg.payload as RecordingStarted),
    );
  }

  onRecordingStopped(): Observable<RecordingStopped> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'recordingStopped'),
      map((msg) => msg.payload as RecordingStopped),
    );
  }

  onAudioLevel(): Observable<AudioLevel> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'audioLevel'),
      map((msg) => msg.payload as AudioLevel),
    );
  }

  onTranscriptionProgress(): Observable<TranscriptionProgress> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'transcriptionProgress'),
      map((msg) => msg.payload as TranscriptionProgress),
    );
  }

  onTranscriptionComplete(): Observable<TranscriptionComplete> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'transcriptionComplete'),
      map((msg) => msg.payload as TranscriptionComplete),
    );
  }

  onAuthSessionResult(): Observable<AuthSessionResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'authSessionResult'),
      map((msg) => msg.payload as AuthSessionResult),
    );
  }

  onError(): Observable<ErrorMessage> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'error'),
      map((msg) => msg.payload as ErrorMessage),
    );
  }

  onPushPermissionResult(): Observable<PushPermissionResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'pushPermissionResult'),
      map((msg) => msg.payload as PushPermissionResponse),
    );
  }

  onPushUnregistered(): Observable<PushUnregisteredResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'pushUnregistered'),
      map((msg) => msg.payload as PushUnregisteredResponse),
    );
  }

  onPushStatus(): Observable<PushStatusResponse> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'pushStatus'),
      map((msg) => msg.payload as PushStatusResponse),
    );
  }

  onNotificationTapped(): Observable<NotificationTapped> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'notificationTapped'),
      map((msg) => msg.payload as NotificationTapped),
    );
  }

  onForegroundNotification(): Observable<ForegroundNotification> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'foregroundNotification'),
      map((msg) => msg.payload as ForegroundNotification),
    );
  }

  // MARK: - Send Messages

  private sendMessage(message: WebToNativeMessageType): void {
    if (!this._isNativeApp) {
      return;
    }

    const handler = window.webkit?.messageHandlers?.nativeBridge;
    if (!handler) {
      return;
    }

    handler.postMessage(JSON.stringify(message));
  }

  // MARK: - Server Management

  getServerList(): void {
    this.sendMessage({ type: 'getServerList' });
  }

  getActiveServer(): void {
    this.sendMessage({ type: 'getActiveServer' });
  }

  setActiveServer(serverId: string): void {
    this.sendMessage({
      type: 'setActiveServer',
      payload: { serverId },
    });
  }

  validateServer(url: string): void {
    this.sendMessage({
      type: 'validateServer',
      payload: { url },
    });
  }

  addServer(name: string, url: string, apiUrl?: string): void {
    this.sendMessage({
      type: 'addServer',
      payload: { name, url, apiUrl },
    });
  }

  removeServer(serverId: string): void {
    this.sendMessage({
      type: 'removeServer',
      payload: { serverId },
    });
  }

  // MARK: - Token Management

  saveToken(token: string, serverId?: string): void {
    this.sendMessage({
      type: 'saveToken',
      payload: { token, serverId },
    });
  }

  getToken(serverId?: string): void {
    this.sendMessage({
      type: 'getToken',
      payload: serverId ? { serverId } : undefined,
    });
  }

  clearToken(serverId?: string): void {
    this.sendMessage({
      type: 'clearToken',
      payload: serverId ? { serverId } : undefined,
    });
  }

  // MARK: - Push Notifications

  requestPushPermission(): void {
    this.sendMessage({ type: 'requestPushPermission' });
  }

  unregisterPushNotifications(): void {
    this.sendMessage({ type: 'unregisterPushNotifications' });
  }

  getPushStatus(): void {
    this.sendMessage({ type: 'getPushStatus' });
  }

  /**
   * Set the app icon badge count
   * @param count - The badge count to display (0 to clear)
   */
  setBadge(count: number): void {
    this.sendMessage({
      type: 'setBadge',
      payload: { count },
    });
  }

  // MARK: - File Sharing

  /**
   * Share a file using the native share sheet
   * @param filename - The name of the file to share
   * @param mimeType - MIME type of the file (e.g., 'text/markdown', 'text/html')
   * @param data - Base64-encoded file content
   */
  shareFile(filename: string, mimeType: string, data: string): void {
    this.sendMessage({
      type: 'shareFile',
      payload: { filename, mimeType, data },
    });
  }

  // MARK: - Audio Recording

  /**
   * Start audio recording
   * @param options.includeSystemAudio - If true, also capture system audio (macOS only, requires screen recording permission)
   */
  startRecording(options?: { includeSystemAudio?: boolean }): void {
    this.sendMessage({
      type: 'startRecording',
      payload: options ? { includeSystemAudio: options.includeSystemAudio } : undefined,
    });
  }

  stopRecording(): void {
    this.sendMessage({ type: 'stopRecording' });
  }

  cancelRecording(): void {
    this.sendMessage({ type: 'cancelRecording' });
  }

  // MARK: - File System Operations

  /**
   * Open a native folder picker dialog
   */
  openFolderPicker(): void {
    this.sendMessage({ type: 'openFolderPicker' });
  }

  /**
   * List files in a directory
   * @param path - Directory path
   * @param extension - Optional file extension filter (e.g., '.md')
   */
  listFiles(path: string, extension?: string): void {
    this.sendMessage({
      type: 'listFiles',
      payload: { path, extension },
    });
  }

  /**
   * Read a file's contents
   * @param path - Full file path
   */
  readFile(path: string): void {
    this.sendMessage({
      type: 'readFile',
      payload: { path },
    });
  }

  /**
   * Write content to a file
   * @param path - Full file path
   * @param content - File content to write
   */
  writeFile(path: string, content: string): void {
    this.sendMessage({
      type: 'writeFile',
      payload: { path, content },
    });
  }

  /**
   * Delete a file
   * @param path - Full file path
   */
  deleteFile(path: string): void {
    this.sendMessage({
      type: 'deleteFile',
      payload: { path },
    });
  }

  // MARK: - File System Response Observables

  onFolderPickerResult(): Observable<FolderPickerResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'folderPickerResult'),
      map((msg) => msg.payload as FolderPickerResult),
    );
  }

  onFileListResult(): Observable<FileListResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'fileListResult'),
      map((msg) => msg.payload as FileListResult),
    );
  }

  onFileReadResult(): Observable<FileReadResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'fileReadResult'),
      map((msg) => msg.payload as FileReadResult),
    );
  }

  onFileWriteResult(): Observable<FileWriteResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'fileWriteResult'),
      map((msg) => msg.payload as FileWriteResult),
    );
  }

  onFileDeleteResult(): Observable<FileDeleteResult> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'fileDeleteResult'),
      map((msg) => msg.payload as FileDeleteResult),
    );
  }

  // MARK: - API Requests

  /**
   * Send an HTTP request through the native networking layer.
   * Returns a promise that resolves with the response.
   * Only works in native apps — web has no access to this.
   */
  sendApiRequest(payload: ApiRequestPayload): Promise<ApiResponsePayload> {
    return new Promise((resolve, reject) => {
      if (!this._isNativeApp) {
        reject(new Error('API requests are only available in the native app'));
        return;
      }

      const sub = this.onApiResponse().subscribe((response) => {
        sub.unsubscribe();
        resolve(response);
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Request timed out'));
      }, 60_000);

      this.sendMessage({
        type: 'apiRequest',
        payload,
      });
    });
  }

  onApiResponse(): Observable<ApiResponsePayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'apiResponse'),
      map((msg) => msg.payload as ApiResponsePayload),
    );
  }

  // MARK: - OAuth

  openAuthSession(url: string, callbackScheme: string): void {
    this.sendMessage({
      type: 'openAuthSession',
      payload: { url, callbackScheme },
    });
  }

  sendGmailOAuthResult(result: GmailOAuthResultPayload): void {
    this.sendMessage({
      type: 'gmailOAuthResult',
      payload: result,
    });
  }
}
