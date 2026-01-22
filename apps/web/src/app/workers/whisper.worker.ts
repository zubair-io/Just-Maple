/// <reference lib="webworker" />

import { pipeline, env } from '@huggingface/transformers';

// Configure for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

export interface WhisperWorkerMessage {
  type: 'load' | 'transcribe';
  audio?: Float32Array;
  model?: string;
  quantization?: 'q8' | 'q4' | 'fp16';
}

export interface WhisperProgressInfo {
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  status?: string;
  name?: string;
}

export interface WhisperWorkerResponse {
  type: 'status' | 'progress' | 'ready' | 'complete' | 'error';
  status?: string;
  progress?: WhisperProgressInfo;
  text?: string;
  segments?: { text: string; start: number; end: number }[];
  error?: string;
}

self.onmessage = async (event: MessageEvent<WhisperWorkerMessage>) => {
  const { type, audio, model, quantization } = event.data;

  if (type === 'load') {
    try {
      // Post loading status
      self.postMessage({ type: 'status', status: 'loading' } as WhisperWorkerResponse);

      // Load model (cached after first download)
      transcriber = await pipeline(
        'automatic-speech-recognition',
        model || 'onnx-community/moonshine-base-ONNX',
        {
          dtype: quantization || 'q8',
          device: 'wasm', // Use WASM for broad browser support
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          progress_callback: (progressData: any) => {
            // Extract relevant progress info
            const progressInfo: WhisperProgressInfo = {
              file: progressData?.file,
              progress: progressData?.progress,
              loaded: progressData?.loaded,
              total: progressData?.total,
              status: progressData?.status,
              name: progressData?.name,
            };
            self.postMessage({
              type: 'progress',
              progress: progressInfo,
            } as WhisperWorkerResponse);
          },
        },
      );

      self.postMessage({ type: 'ready' } as WhisperWorkerResponse);
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      } as WhisperWorkerResponse);
    }
  }

  if (type === 'transcribe') {
    if (!transcriber) {
      self.postMessage({ type: 'error', error: 'Model not loaded' } as WhisperWorkerResponse);
      return;
    }

    if (!audio) {
      self.postMessage({
        type: 'error',
        error: 'No audio data provided',
      } as WhisperWorkerResponse);
      return;
    }

    try {
      const result = await transcriber(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      // Handle both single output and array output
      const output = Array.isArray(result) ? result[0] : result;

      // Map chunks to TranscriptSegment format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const segments = output.chunks?.map((chunk: any) => ({
        text: String(chunk.text || '').trim(),
        start: chunk.timestamp?.[0] ?? 0,
        end: chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0,
      }));

      self.postMessage({
        type: 'complete',
        text: String(output.text || '').trim(),
        segments,
      } as WhisperWorkerResponse);
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      } as WhisperWorkerResponse);
    }
  }
};
