import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { WhisperService } from './whisper.service';

/** Audio stays on this device; only the reviewed/transcribed turn goes to the bot. */
@Injectable()
export class VoiceConversationService implements OnDestroy {
  private readonly whisper = inject(WhisperService);
  readonly state = signal<'idle' | 'listening' | 'transcribing' | 'speaking'>('idle');
  readonly error = signal<string | null>(null);
  readonly modelLoading = this.whisper.isLoading;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private limit?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private utterance?: SpeechSynthesisUtterance;
  private recording?: Promise<Blob>;
  async start(): Promise<void> {
    this.stop();
    this.error.set(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw new Error('Voice recording is unavailable on this device.');
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (error) {
      this.releaseMicrophone();
      throw error;
    }
    this.recorder = recorder;
    this.recording = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.onerror = () => reject(new Error('The microphone recording failed.'));
    });
    // The caller finishes this turn explicitly, before any text goes to a provider.
    void this.recording.catch(() => {});
    try {
      recorder.start();
    } catch (error) {
      this.releaseMicrophone();
      this.recorder = undefined;
      throw error;
    }
    this.state.set('listening');
    this.limit = setTimeout(() => {
      this.error.set('One minute reached. Tap Stop and send to finish this turn.');
      if (recorder.state === 'recording') recorder.stop();
      this.releaseMicrophone();
    }, 60_000);
  }
  async finish(): Promise<string> {
    if (!this.recorder || !this.recording) return '';
    const generation = this.generation;
    clearTimeout(this.limit);
    if (this.recorder.state === 'recording') this.recorder.stop();
    this.releaseMicrophone();
    this.state.set('transcribing');
    try {
      const blob = await this.recording;
      if (generation !== this.generation) return '';
      if (this.whisper.isTranscribing())
        throw new Error('Another recording is being transcribed. Try again when it finishes.');
      const result = await this.whisper.transcribe(blob);
      return generation === this.generation ? result.text.trim() : '';
    } finally {
      if (generation === this.generation) {
        this.state.set('idle');
        this.recorder = undefined;
      }
    }
  }
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      this.error.set('Spoken replies are unavailable; the full reply is shown here.');
      return;
    }
    speechSynthesis.cancel();
    const voice =
      speechSynthesis
        .getVoices()
        .find(
          (voice) =>
            voice.localService && voice.lang.startsWith(navigator.language.split('-')[0] || 'en'),
        ) || speechSynthesis.getVoices().find((voice) => voice.localService);
    if (!voice) {
      this.error.set(
        'No local voice is ready. The full reply is shown here; you can try Read aloud again.',
      );
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
    this.utterance = utterance;
    utterance.voice = voice;
    utterance.onend = () => {
      if (this.utterance === utterance) this.state.set('idle');
    };
    utterance.onerror = () => {
      if (this.utterance === utterance) this.state.set('idle');
    };
    this.state.set('speaking');
    speechSynthesis.speak(utterance);
  }
  stop(): void {
    this.generation++;
    clearTimeout(this.limit);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = undefined;
    this.releaseMicrophone();
    if (this.utterance && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.utterance = undefined;
    this.state.set('idle');
  }
  private releaseMicrophone(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
  ngOnDestroy(): void {
    this.stop();
  }
}
