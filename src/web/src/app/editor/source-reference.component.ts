import {
  Component,
  ChangeDetectionStrategy,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
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
      <span>{{ row()?.sender || reference().kind }}</span
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
