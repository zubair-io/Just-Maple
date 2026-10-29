import { Injectable, inject, signal } from '@angular/core';
import type { Editor } from '@tiptap/core';
import type { KokoroTTS } from 'kokoro-js';
import { TtsService } from './tts.service';
import { PreferencesService } from './preferences.service';
import { encodeFloat32ToInt16Wav } from '../utils/wav-encoder';

type VoiceId = keyof KokoroTTS['voices'];

export type ReaderStatus = 'idle' | 'loading' | 'playing' | 'paused';

@Injectable({ providedIn: 'root' })
export class ReaderService {
  private readonly tts = inject(TtsService);
  private readonly prefs = inject(PreferencesService);

  readonly status = signal<ReaderStatus>('idle');
  readonly currentSentence = signal<string>('');

  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private currentBlobUrl: string | null = null;

  async start(editor: Editor): Promise<void> {
    if (this.status() !== 'idle') return;

    const text = extractText(editor);
    if (!text.trim()) return;

    this.abort = new AbortController();
    const signal = this.abort.signal;

    this.status.set('loading');
    let tts;
    try {
      tts = await this.tts.load(this.prefs.readerDevice());
    } catch (err) {
      console.error('[ReaderService] TTS load failed', err);
      this.cleanup();
      return;
    }

    if (signal.aborted) {
      this.cleanup();
      return;
    }

    if (!this.audio) {
      this.audio = new Audio();
    }
    this.audio.playbackRate = this.prefs.readerSpeed();

    try {
      const stream = tts.stream(text, { voice: this.prefs.readerVoice() as VoiceId });
      let firstChunk = true;
      for await (const chunk of stream) {
        if (signal.aborted) break;
        this.currentSentence.set(chunk.text);
        const blob = encodeFloat32ToInt16Wav(chunk.audio.audio, chunk.audio.sampling_rate);
        const url = URL.createObjectURL(blob);
        await this.playUrl(url, signal, firstChunk);
        firstChunk = false;
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error('[ReaderService] stream error', err);
      }
    } finally {
      this.cleanup();
    }
  }

  pause(): void {
    if (this.status() !== 'playing' || !this.audio) return;
    this.audio.pause();
    this.status.set('paused');
  }

  resume(): void {
    if (this.status() !== 'paused' || !this.audio) return;
    void this.audio.play();
    this.status.set('playing');
  }

  stop(): void {
    if (this.status() === 'idle') return;
    this.abort?.abort();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.cleanup();
  }

  private async playUrl(url: string, signal: AbortSignal, isFirst: boolean): Promise<void> {
    if (!this.audio) return;
    const audio = this.audio;
    this.revokeCurrentUrl();
    this.currentBlobUrl = url;
    audio.src = url;

    await new Promise<void>((resolve) => {
      const onPlaying = () => {
        if (isFirst && this.status() === 'loading') {
          this.status.set('playing');
        }
        audio.removeEventListener('playing', onPlaying);
      };
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        audio.pause();
        cleanup();
        resolve();
      };
      const cleanup = () => {
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      signal.addEventListener('abort', onAbort);
      audio.play().catch(() => {
        cleanup();
        resolve();
      });
    });
  }

  private revokeCurrentUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  private cleanup(): void {
    this.revokeCurrentUrl();
    this.abort = null;
    this.currentSentence.set('');
    this.status.set('idle');
  }
}

function extractText(editor: Editor): string {
  const { selection, doc } = editor.state;
  if (!selection.empty) {
    return doc.textBetween(selection.from, selection.to, '\n\n', ' ');
  }

  const blocks: string[] = [];
  doc.descendants((node) => {
    const typeName = node.type.name;

    if (typeName === 'codeBlock' || typeName === 'horizontalRule') {
      return false;
    }
    if (typeName === 'image') {
      const alt = (node.attrs as { alt?: string } | null)?.alt;
      if (alt) blocks.push(alt);
      return false;
    }
    // taskItem is a block (`content: 'paragraph+'`), not a textblock, so it
    // wouldn't match the isTextblock branch below. Handle it explicitly so
    // we can prefix the spoken text with the todo/done state.
    if (typeName === 'taskItem') {
      const text = node.textContent.trim();
      if (text) {
        const checked = (node.attrs as { checked?: boolean } | null)?.checked;
        blocks.push(`${checked ? 'done' : 'todo'}: ${text}`);
      }
      return false;
    }
    if (node.isBlock && node.isTextblock) {
      const text = node.textContent.trim();
      if (text) blocks.push(text);
      return false;
    }
    return true;
  });
  return blocks.join('\n\n');
}
