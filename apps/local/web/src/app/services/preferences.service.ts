import { Injectable, effect, inject, signal } from '@angular/core';
import { NativeBridgeService } from './native-bridge.service';
import { DEFAULT_VOICE_IDS, type TtsDevice } from './tts.service';

const READER_VOICE_KEY = 'reader.voice';
const READER_DEVICE_KEY = 'reader.device';
const READER_SPEED_KEY = 'reader.speed';
const DEFAULT_VOICE = 'af_heart';

@Injectable({
  providedIn: 'root',
})
export class PreferencesService {
  private readonly nativeBridge = inject(NativeBridgeService);

  readonly readerVoice = signal<string>(
    readLocal(READER_VOICE_KEY, DEFAULT_VOICE, (v) => (DEFAULT_VOICE_IDS.includes(v) ? v : null)),
  );
  readonly readerDevice = signal<TtsDevice>(
    readLocal<TtsDevice>(READER_DEVICE_KEY, 'wasm', (v) =>
      v === 'auto' || v === 'webgpu' || v === 'wasm' ? v : null,
    ),
  );
  readonly readerSpeed = signal<number>(
    readLocal<number>(READER_SPEED_KEY, 1.0, (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : null;
    }),
  );

  constructor() {
    effect(() => writeLocal(READER_VOICE_KEY, this.readerVoice()));
    effect(() => writeLocal(READER_DEVICE_KEY, this.readerDevice()));
    effect(() => writeLocal(READER_SPEED_KEY, String(this.readerSpeed())));
  }

  isNativeApp(): boolean {
    return this.nativeBridge.isNativeApp();
  }
}

function readLocal<T>(key: string, fallback: T, parse?: (raw: string) => T | null): T {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  if (!parse) return raw as unknown as T;
  const parsed = parse(raw);
  return parsed == null ? fallback : parsed;
}

function writeLocal(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private-mode errors
  }
}
