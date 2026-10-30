import { Injectable, inject, signal } from '@angular/core';
import { NativeBridgeService } from './native-bridge.service';
import type { RecorderRequest, RecorderResponse, RecorderState } from '../types/recorder.types';

type Command = Omit<RecorderRequest, 'requestId'>;
@Injectable({ providedIn: 'root' })
export class RecorderWorkspaceService {
  private readonly bridge = inject(NativeBridgeService);
  readonly state = signal<RecorderState | null>(null);
  readonly error = signal<string | null>(null);
  readonly connected = this.bridge.isNativeApp();
  private selectedId?: string;
  private sequence = 0;
  private appliedSequence = 0;
  private polling?: ReturnType<typeof setInterval>;
  private pollInFlight = false;
  private visible = false;
  private readonly pending = new Map<
    string,
    {
      resolve: (response: RecorderResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      sequence: number;
    }
  >();

  constructor() {
    this.bridge.messages$.subscribe((message) => {
      if (message.type !== 'recorderResponse') return;
      const response = message.payload as RecorderResponse;
      if (!response || typeof response.requestId !== 'string') return;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.requestId);
      if (response.state && pending.sequence >= this.appliedSequence) {
        this.appliedSequence = pending.sequence;
        this.state.set(response.state);
        this.selectedId = response.state.selected?.id;
      }
      if (response.error) pending.reject(new Error(response.error));
      else pending.resolve(response);
    });
  }

  open(): void {
    this.visible = true;
    if (!this.connected || this.polling) return;
    void this.poll();
    this.polling = setInterval(() => void this.poll(), 1000);
  }

  close(): void {
    this.visible = false;
    if (!this.hasActiveWork()) this.stopPolling();
    // Keep the status indicator current while recording or processing in another notebook.
  }

  async select(id: string): Promise<void> {
    this.selectedId = id;
    await this.command({ operation: 'state', recordingId: id });
  }

  async command(command: Command): Promise<RecorderResponse> {
    this.error.set(null);
    try {
      return await this.request(command);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Recorder request failed.');
      throw error;
    }
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      await this.request({ operation: 'state' });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Recorder is unavailable.');
    } finally {
      this.pollInFlight = false;
      if (!this.visible && !this.hasActiveWork()) this.stopPolling();
    }
  }

  private hasActiveWork(): boolean {
    const state = this.state();
    return !!(state?.isRecording || state?.busy || state?.playback.playing);
  }

  private stopPolling(): void {
    clearInterval(this.polling);
    this.polling = undefined;
  }

  private request(command: Command): Promise<RecorderResponse> {
    if (!this.connected)
      return Promise.reject(new Error('Open JapaneseMaple’s Apple app to use the local recorder.'));
    const sequence = ++this.sequence;
    const requestId = `recorder-${Date.now()}-${sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          reject(new Error('The Apple recorder did not respond. Update the app and try again.'));
        },
        command.operation === 'state' ? 15_000 : 120_000,
      );
      this.pending.set(requestId, { resolve, reject, timer, sequence });
      try {
        this.bridge.recorderRequest({ recordingId: this.selectedId, ...command, requestId });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
}
