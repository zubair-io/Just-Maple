import { Injectable, signal } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
  NativeToWebMessage,
  WebToNativeMessageType,
  InitialState,
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
  ICloudContainerPathResult,
  ApiRequestPayload,
  ApiResponsePayload,
  SidebarNavigatePayload,
  SidebarPageCreatedPayload,
  SidebarPageTrashedPayload,
  SidebarPageRenamedPayload,
  SidebarPageMovedPayload,
  SidebarNotebookCreatedPayload,
  SidebarNotebookRenamedPayload,
  SidebarNotebookDeletedPayload,
  SidebarNewPagePayload,
  SidebarActiveChangedPayload,
  SidebarDataChangedPayload,
  SidebarUnreadCountsPayload,
} from '../types/native-bridge.types';

@Injectable({
  providedIn: 'root',
})
export class NativeBridgeService {
  private readonly _messages$ = new Subject<NativeToWebMessage>();
  private _isNativeApp = false;
  private _initialState: InitialState | null = null;

  /** Reactive signal for native app detection (updates on late detection via iOS initialize message) */
  readonly isNativeApp$ = signal(false);

  // Public observables for different message types
  readonly messages$ = this._messages$.asObservable();

  constructor() {
    this.detectNativeApp();
    // Always set up receiver — on iOS the message handler may not be detectable
    // at bootstrap time, but initialize message will arrive later via didFinish
    this.setupMessageReceiver();
  }

  // MARK: - Detection

  private detectNativeApp(): void {
    const handler = !!window.webkit?.messageHandlers?.nativeBridge;
    this._isNativeApp = handler;
    this.isNativeApp$.set(this._isNativeApp);
    console.log(
      `[NativeBridge] detectNativeApp: handler=${handler}, isNative=${this._isNativeApp}`,
    );
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
    // Drain any messages that arrived before Angular bootstrapped
    // (buffered by the inline script in index.html)
    const buffered = (window.__nativeBridge__ as any)?._buffer as NativeToWebMessage[] | undefined;
    console.log(`[NativeBridge] setupMessageReceiver: buffered=${buffered?.length ?? 0} messages`);

    window.__nativeBridge__ = {
      receive: (message: NativeToWebMessage) => {
        this.handleIncoming(message);
      },
    };

    if (buffered) {
      for (const message of buffered) {
        this.handleIncoming(message);
      }
    }
  }

  private handleIncoming(message: NativeToWebMessage): void {
    console.log(`[NativeBridge] handleIncoming: type=${message.type}`);
    // Store initial state and mark as native app (handles late detection on iOS)
    if (message.type === 'initialize') {
      this._initialState = message.payload as InitialState;
      console.log(
        '[NativeBridge] initialize received, hasNativeSidebar=',
        (message.payload as InitialState)?.hasNativeSidebar,
        'wasNative=',
        this._isNativeApp,
      );
      if (!this._isNativeApp) {
        this._isNativeApp = true;
        this.isNativeApp$.set(true);
        console.log('[NativeBridge] Late native app detection → isNative=true');
      }
    }

    // Dispatch CustomEvent for apiResponse so non-Angular listeners
    // (e.g. vanilla DOM NodeViews) can receive responses by requestId
    if (message.type === 'apiResponse') {
      window.dispatchEvent(new CustomEvent('maple:apiResponse', { detail: message.payload }));
    }

    this._messages$.next(message);
  }

  // MARK: - Typed Observables

  onInitialize(): Observable<InitialState> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'initialize'),
      map((msg) => msg.payload as InitialState),
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

  // MARK: - iCloud

  /**
   * Request the iCloud container info from the native app.
   * Returns an Observable that emits the container path and its child folders.
   */
  getICloudContainerPath(): Observable<ICloudContainerPathResult> {
    this.sendMessage({ type: 'getICloudContainerPath' });
    return this.messages$.pipe(
      filter((msg) => msg.type === 'icloudContainerPath'),
      map((msg) => msg.payload as ICloudContainerPathResult),
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

      const requestId = crypto.randomUUID();

      const timeoutId = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('Request timed out'));
      }, 60_000);

      const sub = this.onApiResponse()
        .pipe(filter((response) => response.requestId === requestId))
        .subscribe((response) => {
          clearTimeout(timeoutId);
          sub.unsubscribe();
          resolve(response);
        });

      this.sendMessage({
        type: 'apiRequest',
        payload: { ...payload, requestId },
      });
    });
  }

  onApiResponse(): Observable<ApiResponsePayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'apiResponse'),
      map((msg) => msg.payload as ApiResponsePayload),
    );
  }

  // MARK: - Native Sidebar

  hasNativeSidebar(): boolean {
    console.log(`[NativeBridge] hasNativeSidebar called → ${this._isNativeApp}`);
    return this._isNativeApp;
  }

  // Native → Web observables

  onSidebarNavigate(): Observable<SidebarNavigatePayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarNavigate'),
      map((msg) => msg.payload as SidebarNavigatePayload),
    );
  }

  onSidebarPageCreated(): Observable<SidebarPageCreatedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarPageCreated'),
      map((msg) => msg.payload as SidebarPageCreatedPayload),
    );
  }

  onSidebarPageTrashed(): Observable<SidebarPageTrashedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarPageTrashed'),
      map((msg) => msg.payload as SidebarPageTrashedPayload),
    );
  }

  onSidebarPageRenamed(): Observable<SidebarPageRenamedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarPageRenamed'),
      map((msg) => msg.payload as SidebarPageRenamedPayload),
    );
  }

  onSidebarPageMoved(): Observable<SidebarPageMovedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarPageMoved'),
      map((msg) => msg.payload as SidebarPageMovedPayload),
    );
  }

  onSidebarNotebookCreated(): Observable<SidebarNotebookCreatedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarNotebookCreated'),
      map((msg) => msg.payload as SidebarNotebookCreatedPayload),
    );
  }

  onSidebarNotebookRenamed(): Observable<SidebarNotebookRenamedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarNotebookRenamed'),
      map((msg) => msg.payload as SidebarNotebookRenamedPayload),
    );
  }

  onSidebarNotebookDeleted(): Observable<SidebarNotebookDeletedPayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarNotebookDeleted'),
      map((msg) => msg.payload as SidebarNotebookDeletedPayload),
    );
  }

  onSidebarNewPage(): Observable<SidebarNewPagePayload> {
    return this.messages$.pipe(
      filter((msg) => msg.type === 'sidebarNewPage'),
      map((msg) => msg.payload as SidebarNewPagePayload),
    );
  }

  // Web → Native send methods

  sendSidebarActiveChanged(payload: SidebarActiveChangedPayload): void {
    this.sendMessage({ type: 'sidebarActiveChanged', payload });
  }

  sendSidebarDataChanged(payload: SidebarDataChangedPayload): void {
    this.sendMessage({ type: 'sidebarDataChanged', payload });
  }

  sendSidebarUnreadCounts(payload: SidebarUnreadCountsPayload): void {
    this.sendMessage({ type: 'sidebarUnreadCounts', payload });
  }

  toggleNativeSidebar(): void {
    this.sendMessage({ type: 'toggleNativeSidebar' });
  }

  // MARK: - OAuth

  openAuthSession(url: string, callbackScheme: string, callbackURL?: string): void {
    this.sendMessage({
      type: 'openAuthSession',
      payload: { url, callbackScheme, callbackURL },
    });
  }

  sendGmailOAuthResult(result: GmailOAuthResultPayload): void {
    this.sendMessage({
      type: 'gmailOAuthResult',
      payload: result,
    });
  }
}
