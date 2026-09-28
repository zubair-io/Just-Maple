import {
  Component,
  ChangeDetectionStrategy,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { sourceReferenceKind } from "../sources/source-reference-kind";
import { SourceReference } from "./daily-markdown-codec";
import { SourcesService, SourceRow } from "../sources/sources.service";
@Component({
  selector: "maple-source-reference",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <article
    class="source-card"
    [attr.aria-label]="reference().kind + ' reference'"
  >
    <div class="source-card-meta">
      <span class="source-origin"
        ><span class="source-kind">{{ kindLabel() }}</span
        >{{ row()?.sender }}</span
      ><span>{{ row()?.connector || "Source reference" }}</span>
    </div>
    <button
      class="source-card-title"
      type="button"
      (click)="inspected.emit(reference().eventID)"
    >
      {{ row()?.subject || reference().label || "Open captured source" }}
    </button>
    @if (row(); as source) {
      <p>{{ source.preview }}</p>
      @if (kindLabel() === "Home event" && source.observedState) {
        <p class="source-observed-state">
          Observed state · {{ source.observedState }}
        </p>
      }
      <div class="source-card-footer">
        <span>{{ source.type }} · {{ source.status }}</span
        ><button type="button" (click)="inspected.emit(source.id)">
          State & history ↗
        </button>
      </div>
    } @else {
      <p>
        {{
          unavailable()
            ? "Source unavailable. This reference is preserved."
            : "Loading captured source…"
        }}
      </p>
    }
    @if (reference().kind === "recording") {
      <small
        >Audio unavailable · inspect captured transcript and provenance</small
      >
    }
  </article>`,
  styles: [
    `
      :host {
        display: block;
      }
      .source-card {
        padding: 18px 20px;
        border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-info, var(--color-primary));
        border-radius: 6px;
        background: var(--color-bg-secondary);
        font-family: var(--font-sans);
      }
      .source-origin {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .source-kind {
        white-space: nowrap;
        border: 1px solid var(--color-border);
        border-radius: 5px;
        padding: 2px 6px;
        font-size: 11px;
        color: var(--color-text-main);
      }
      .source-observed-state {
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .source-card-meta,
      .source-card-footer {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        font-size: 12px;
        color: var(--color-text-muted);
      }
      button {
        border: 0;
        background: transparent;
        color: var(--color-text-main);
        font: inherit;
        cursor: pointer;
        text-align: left;
        padding: 0;
      }
      .source-card-title {
        font-size: 17px;
        line-height: 1.5;
        margin: 10px 0 0;
      }
      p {
        font-size: 14px;
        line-height: 1.6;
        color: var(--color-text-muted);
        margin: 8px 0 14px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .source-card-footer button {
        font-size: 12px;
        color: var(--color-link, var(--color-primary));
      }
      button:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
        outline-offset: 4px;
      }
      small {
        font-size: 12px;
        color: var(--color-text-muted);
      }
    `,
  ],
})
export class SourceReferenceComponent {
  readonly reference = input.required<SourceReference>();
  readonly inspected = output<string>();
  readonly row = signal<SourceRow | null>(null);
  readonly unavailable = signal(false);
  kindLabel() {
    const row = this.row();
    const kind = row ? sourceReferenceKind(row) : this.reference().kind;
    return (
      (
        {
          email: "Email",
          message: "Message",
          imessage: "Message",
          home: "Home event",
          ha: "Home event",
          calendar: "Calendar",
          recording: "Recording",
        } as Record<string, string>
      )[kind] ?? "Source"
    );
  }
  private service = inject(SourcesService);
  private generation = 0;
  constructor() {
    effect(() => {
      const id = this.reference().eventID;
      const generation = ++this.generation;
      this.row.set(null);
      this.unavailable.set(false);
      void this.service
        .detail(id)
        .then((detail) => {
          if (generation === this.generation) this.row.set(detail.row);
        })
        .catch(() => {
          if (generation === this.generation) this.unavailable.set(true);
        });
    });
  }
}
