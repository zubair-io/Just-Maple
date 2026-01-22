import { Injectable, signal, OnDestroy } from '@angular/core';
import type {
  WhisperWorkerMessage,
  WhisperWorkerResponse,
  WhisperProgressInfo,
} from '../workers/whisper.worker';

export interface TranscriptionResult {
  text: string;
  segments?: { text: string; start: number; end: number }[];
}

@Injectable({ providedIn: 'root' })
export class WhisperService implements OnDestroy {
  private worker: Worker | null = null;

  // Signals for reactive state
  readonly isLoading = signal(false);
  readonly isTranscribing = signal(false);
  readonly progress = signal<WhisperProgressInfo | null>(null);
  readonly error = signal<string | null>(null);
  readonly isModelLoaded = signal(false);

  // Model configuration (Moonshine is faster and more efficient than Whisper)
  readonly model = signal('onnx-community/moonshine-base-ONNX');
  readonly quantization = signal<'q8' | 'q4' | 'fp16'>('q8');

  ngOnDestroy(): void {
    this.dispose();
  }

  /**
   * Initialize the worker and load the model
   */
  async loadModel(): Promise<void> {
    if (this.isModelLoaded()) return;

    this.error.set(null);
    this.isLoading.set(true);

    // Create worker
    this.worker = new Worker(new URL('../workers/whisper.worker', import.meta.url), {
      type: 'module',
    });

    return new Promise<void>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Failed to create worker'));
        return;
      }

      this.worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) => {
        const { type, progress, error } = event.data;

        if (type === 'progress' && progress) {
          this.progress.set(progress);
        }

        if (type === 'ready') {
          this.isLoading.set(false);
          this.isModelLoaded.set(true);
          resolve();
        }

        if (type === 'error') {
          this.isLoading.set(false);
          this.error.set(error || 'Unknown error');
          reject(new Error(error));
        }
      };

      this.worker.onerror = (err) => {
        this.isLoading.set(false);
        this.error.set(err.message);
        reject(new Error(err.message));
      };

      // Send load message
      const message: WhisperWorkerMessage = {
        type: 'load',
        model: this.model(),
        quantization: this.quantization(),
      };
      this.worker.postMessage(message);
    });
  }

  /**
   * Transcribe audio blob
   */
  async transcribe(audioBlob: Blob): Promise<TranscriptionResult> {
    // Load model if not already loaded
    if (!this.isModelLoaded()) {
      await this.loadModel();
    }

    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    this.error.set(null);
    this.isTranscribing.set(true);

    // Convert blob to Float32Array (16kHz mono)
    const audioData = await this.prepareAudio(audioBlob);

    return new Promise<TranscriptionResult>((resolve, reject) => {
      if (!this.worker) {
        this.isTranscribing.set(false);
        reject(new Error('Worker not initialized'));
        return;
      }

      this.worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) => {
        const { type, text, segments, error } = event.data;

        if (type === 'complete') {
          this.isTranscribing.set(false);
          resolve({
            text: text || '',
            segments,
          });
        }

        if (type === 'error') {
          this.isTranscribing.set(false);
          this.error.set(error || 'Transcription failed');
          reject(new Error(error));
        }
      };

      // Send transcribe message
      const message: WhisperWorkerMessage = {
        type: 'transcribe',
        audio: audioData,
      };
      this.worker.postMessage(message);
    });
  }

  /**
   * Convert audio blob to Float32Array at 16kHz mono
   */
  private async prepareAudio(blob: Blob): Promise<Float32Array> {
    const audioContext = new AudioContext({ sampleRate: 16000 });

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get first channel data
      const channelData = audioBuffer.getChannelData(0);

      // If stereo, mix channels
      if (audioBuffer.numberOfChannels > 1) {
        const channel2 = audioBuffer.getChannelData(1);
        const mixed = new Float32Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          mixed[i] = (channelData[i] + channel2[i]) / 2;
        }
        return mixed;
      }

      // Return a copy to avoid issues with the buffer being closed
      return new Float32Array(channelData);
    } finally {
      await audioContext.close();
    }
  }

  /**
   * Set the model to use for transcription
   */
  setModel(model: string): void {
    if (this.isModelLoaded() && model !== this.model()) {
      // Model changed - dispose worker to reload with new model
      this.dispose();
    }
    this.model.set(model);
  }

  /**
   * Set the quantization level
   */
  setQuantization(quantization: 'q8' | 'q4' | 'fp16'): void {
    if (this.isModelLoaded() && quantization !== this.quantization()) {
      // Quantization changed - dispose worker to reload
      this.dispose();
    }
    this.quantization.set(quantization);
  }

  /**
   * Clean up worker
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isModelLoaded.set(false);
    this.isLoading.set(false);
    this.isTranscribing.set(false);
    this.progress.set(null);
  }
}
