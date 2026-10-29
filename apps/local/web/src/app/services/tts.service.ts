import { Injectable, signal } from '@angular/core';
import { KokoroTTS } from 'kokoro-js';

export type TtsDevice = 'auto' | 'webgpu' | 'wasm';
export type TtsDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

@Injectable({ providedIn: 'root' })
export class TtsService {
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly errorMessage = signal<string | null>(null);

  private instance: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private loadedKey: string | null = null;

  async load(device: TtsDevice): Promise<KokoroTTS> {
    // fp16 produces the cleanest audio short of fp32 (~154 MB vs ~305 MB).
    // Cached after the first download.
    const dtype: TtsDtype = 'fp16';
    const key = `${device}:${dtype}`;
    if (this.instance && this.loadedKey === key) return this.instance;
    if (this.loadingPromise && this.loadedKey === key) return this.loadingPromise;

    this.status.set('loading');
    this.errorMessage.set(null);
    this.loadedKey = key;
    const requestKey = key;
    const promise = this.loadWithFallback(device, dtype)
      .then((tts) => {
        // Ignore the result if another load(...) call has since changed the
        // active key — otherwise an older in-flight load could overwrite
        // the newer one's instance/status.
        if (this.loadedKey !== requestKey) return tts;
        this.instance = tts;
        this.status.set('ready');
        return tts;
      })
      .catch((err) => {
        if (this.loadedKey !== requestKey) throw err;
        this.status.set('error');
        this.errorMessage.set(err instanceof Error ? err.message : String(err));
        this.loadingPromise = null;
        this.loadedKey = null;
        throw err;
      });
    this.loadingPromise = promise;
    return promise;
  }

  voices(): string[] {
    if (!this.instance) return DEFAULT_VOICE_IDS;
    return Object.keys(this.instance.voices);
  }

  getInstance(): KokoroTTS | null {
    return this.instance;
  }

  private async loadWithFallback(device: TtsDevice, dtype: TtsDtype): Promise<KokoroTTS> {
    // WebGPU inference for Kokoro currently produces robotic/distorted audio on
    // many GPUs (open issue in onnxruntime-web + kokoro-js). "auto" prefers WASM
    // because it's the reference-quality path; users can still opt into WebGPU
    // explicitly. If WebGPU fails to *load*, we still fall back to WASM.
    const attempts: ('webgpu' | 'wasm')[] = device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];

    let lastErr: unknown = null;
    for (const dev of attempts) {
      try {
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device: dev });
        console.info(`[TtsService] loaded Kokoro on device=${dev} dtype=${dtype}`);
        return tts;
      } catch (err) {
        lastErr = err;
        console.warn(`[TtsService] failed to load on ${dev}, falling back…`, err);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to load Kokoro TTS');
  }
}

export const DEFAULT_VOICE_IDS = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
];
