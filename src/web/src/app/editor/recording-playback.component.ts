import { Component, ChangeDetectionStrategy, DestroyRef, effect, inject, input, output, signal } from "@angular/core";
import { AttachmentService, ATTACHMENT_BYTE_LIMIT, isAttachmentReference } from "./attachment.service";

@Component({
  selector: "maple-recording-playback",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (audioURL()) {
      <audio controls preload="metadata" [src]="audioURL()" aria-label="Recording playback"
        (loadedmetadata)="metadata($event)" (error)="playbackFailed()"></audio>
      @if (duration()) { <span class="duration">{{ duration() }}</span> }
    }
    @if (loading()) { <p role="status">Loading recording…</p> }
    @if (error()) {
      <p role="status">{{ error() }}</p>
      @if (attachmentID()) { <button type="button" (click)="load()" [disabled]="loading()">Retry audio</button> }
    }
    @if (!attachmentID() && !loading()) { <p>No audio attached. Captured source text remains available.</p> }
    @if (documentID() && !readOnly()) {
      <details class="audio-options">
        <summary>{{ attachmentID() ? 'Audio options' : 'Attach existing audio' }}</summary>
        <label class="attach">{{ attachmentID() ? 'Replace attached audio' : 'Choose a recording' }}
          <input type="file" accept=".m4a,.mp3,.wav,audio/mp4,audio/mpeg,audio/wav"
            [disabled]="loading()" (change)="attach($event)" />
        </label>
        <span class="hint">M4A, MP3 or WAV · up to 12 MiB</span>
      </details>
    }
  `,
  styles: [`
    :host { display:block; margin-top:12px; font:inherit; }
    audio { display:block; width:100%; max-width:480px; height:36px; }
    p,.hint,.duration { font-size:13px; color:var(--color-text-muted); }
    p { margin:8px 0; } .duration { display:block; margin-top:4px; }
    .attach { display:block; margin-top:10px; font-size:13px; }
    input { display:block; max-width:100%; margin-top:6px; color:var(--color-text-main); }
    :host button { border:1px solid var(--color-border); border-radius:6px; padding:5px 9px; background:var(--color-bg); color:var(--color-text-main); cursor:pointer; font:13px/1.5 var(--font-sans); }
    .audio-options { margin-top:10px; font:13px/1.5 var(--font-sans); color:var(--color-text-muted); }
    summary { cursor:pointer; } :host-context([data-theme="dark"]) audio,:host-context(.dark) audio { color-scheme:dark; }
    button:focus-visible,input:focus-visible { outline:2px solid var(--color-primary); outline-offset:3px; }
  `],
})
export class RecordingPlaybackComponent {
  readonly documentID = input("");
  readonly eventID = input.required<string>();
  readonly attachmentID = input<string>();
  readonly readOnly = input(false);
  readonly attached = output<{ eventID: string; previousAttachmentID?: string; attachmentID: string }>();
  readonly audioURL = signal("");
  readonly duration = signal("");
  readonly loading = signal(false);
  readonly error = signal("");
  private readonly attachments = inject(AttachmentService);
  private generation = 0;
  private disposed = false;
  constructor() {
    inject(DestroyRef).onDestroy(() => { this.disposed = true; this.generation++; this.audioURL.set(""); });
    effect(() => {
      this.documentID(); this.eventID(); this.attachmentID();
      void this.load();
    });
  }
  async load() {
    const ref = this.attachmentID(), documentID = this.documentID(), generation = ++this.generation;
    this.audioURL.set(""); this.duration.set(""); this.error.set(""); this.loading.set(false);
    if (!ref) return;
    if (!documentID) { this.error.set("Audio playback is available from the authorized notebook on Mac."); return; }
    if (!isAttachmentReference(ref) || !/\.(m4a|mp3|wav)$/.test(ref)) {
      this.error.set("This recording has an unsupported audio reference."); return;
    }
    this.loading.set(true);
    try {
      const result = await this.attachments.read(documentID, ref);
      if (this.disposed || generation !== this.generation) return;
      if (result.status === "missing") throw Error("Audio is missing. Restore it in the notebook, then retry.");
      if (!result.dataURL || result.dataURL.length > Math.ceil(ATTACHMENT_BYTE_LIMIT / 3) * 4 + 100 ||
          !/^data:audio\/(mp4|mpeg|wav);base64,[A-Za-z0-9+/=]+$/.test(result.dataURL))
        throw Error("The attachment is not supported audio.");
      this.audioURL.set(result.dataURL);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error.set(error instanceof Error ? error.message : "Could not load recording.");
    } finally { if (!this.disposed && generation === this.generation) this.loading.set(false); }
  }
  metadata(event: Event) {
    const seconds = (event.target as HTMLAudioElement).duration;
    if (Number.isFinite(seconds) && seconds >= 0) {
      const rounded = Math.floor(seconds);
      this.duration.set(`${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`);
    }
  }
  playbackFailed() { this.audioURL.set(""); this.error.set("This audio could not be played. Retry or attach a supported recording."); }
  async attach(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = "";
    if (!file || this.readOnly() || !this.documentID() || this.loading()) return;
    const eventID = this.eventID(), documentID = this.documentID(), previousAttachmentID = this.attachmentID();
    const generation = ++this.generation;
    this.loading.set(true); this.error.set("");
    try {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      const mime = ({ m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav" } as Record<string, string>)[extension ?? ""];
      if (!mime) throw Error("Choose an M4A, MP3 or WAV recording.");
      const normalized = new File([file], file.name, { type: mime });
      const result = await this.attachments.importFile(documentID, normalized);
      if (this.disposed || generation !== this.generation || this.readOnly() ||
          this.documentID() !== documentID || this.eventID() !== eventID) return;
      if (!result.ref || !isAttachmentReference(result.ref) || !/\.(m4a|mp3|wav)$/.test(result.ref)) throw Error("Invalid recording attachment response.");
      this.attached.emit({ eventID, previousAttachmentID, attachmentID: result.ref });
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.error.set(error instanceof Error ? error.message : "Could not attach recording.");
    } finally { if (!this.disposed && generation === this.generation) this.loading.set(false); }
  }
}
