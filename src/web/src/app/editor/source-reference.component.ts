import { DatePipe } from "@angular/common";
import { Component, ChangeDetectionStrategy, effect, inject, input, output, signal } from "@angular/core";
import { MapleIconComponent } from "@maple/ui";
import { sourceReferenceKind } from "../sources/source-reference-kind";
import { SourceReference } from "./daily-markdown-codec";
import { SourcesService, SourceRow } from "../sources/sources.service";

@Component({
  selector: "maple-source-reference",
  standalone: true,
  imports: [DatePipe, MapleIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="source-card" [attr.aria-label]="kindLabel() + ' reference'">
      <div class="source-card-meta">
        <span class="source-origin">
          <maple-icon [name]="icon()" [size]="19" />
          <span>{{ origin() }}</span>
        </span>
        <span class="source-date"><time [attr.datetime]="observedDate() | date: 'yyyy-MM-ddTHH:mm:ssZZZZZ'">{{ dateLabel() }}</time> · {{ kindLabel() }}</span>
      </div>
      <button class="source-card-title" type="button" (click)="inspected.emit(reference().eventID)"
        [attr.aria-label]="'Open ' + title() + ' — source and processing history'">{{ title() }}</button>
      @if (row(); as source) {
        @if (source.calendar; as calendar) {
          <p class="calendar-time">
            @if (calendar.allDay) { All day } @else {
              {{ date(calendar.start) | date: 'h:mm a' }} – {{ date(calendar.end) | date: 'h:mm a' }}
            }
            @if (calendar.location) { <span> · {{ calendar.location }}</span> }
          </p>
          @if (calendar.notes) { <p class="source-preview">{{ calendar.notes }}</p> }
        } @else { <p class="source-preview">{{ source.preview }}</p> }
      } @else {
        <p class="source-preview">{{ unavailable() ? 'Source unavailable. This reference is preserved.' : 'Loading captured source…' }}</p>
      }
    </article>`,
  styles: [`
    :host { display: block; }
    .source-card { padding: 16px 20px; border: 1px solid var(--color-border); border-left: 4px solid var(--color-info); border-radius: 5px; background: var(--color-bg); font-family: var(--font-sans); color: var(--color-text-main); }
    .source-card-meta { display: flex; justify-content: space-between; align-items: start; gap: 16px; font-size: 13px; line-height: 1.5; color: var(--color-text-muted); }
    .source-origin { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .source-origin span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    maple-icon { flex-shrink: 0; display: inline-flex; }
    .source-date { flex-shrink: 0; white-space: nowrap; }
    .source-card-title { display: block; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; font-size: 17px; line-height: 1.45; margin: 10px 0 0; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
    .source-card-title:hover { text-decoration: underline; text-underline-offset: 3px; }
    .source-card-title:focus-visible { outline: 2px solid var(--color-focus, var(--color-primary)); outline-offset: 4px; border-radius: 2px; }
    .source-card p { margin: 6px 0 0; font-size: 15px; line-height: 1.55; color: var(--color-text-muted); overflow-wrap: anywhere; }
    .source-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .calendar-time { font-variant-numeric: tabular-nums; }
    @media (max-width: 600px) { .source-card { padding: 13px 14px; } .source-card-meta { flex-wrap: wrap; gap: 4px 12px; font-size: 12px; } .source-card-title { font-size: 16px; } p { font-size: 14px; } }
  `],
})
export class SourceReferenceComponent {
  readonly reference = input.required<SourceReference>();
  readonly inspected = output<string>();
  readonly row = signal<SourceRow | null>(null);
  readonly unavailable = signal(false);
  date(value?: string | number) { return typeof value === "number" ? value * 1000 : value ?? null; }
  observedDate() { return this.date(this.row()?.calendar?.start ?? this.row()?.occurredAt); }
  icon(): "calendar" | "mail" | "map-pin" | "history" {
    return this.kindLabel() === "Calendar" ? "calendar" : this.kindLabel() === "Email" || this.kindLabel() === "Message" ? "mail" : this.kindLabel() === "Home event" ? "map-pin" : "history";
  }
  dateLabel() {
    const value = this.observedDate();
    if (value === null) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {weekday: "short", month: "short", day: "numeric", timeZone: this.row()?.calendar?.allDay ? this.row()?.calendar?.timeZone : undefined}).format(date);
  }
  title() { return this.row()?.subject || this.reference().label || "Open captured source"; }
  origin() {
    const row = this.row();
    if (row?.calendar) return row.calendar.name;
    if (this.kindLabel() === "Email") {
      const name = row?.sender?.replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "").trim();
      return row?.direction === "outgoing" ? "You" : name ? name + (row?.direction === "incoming" ? " → you" : "") : "Email";
    }
    return this.kindLabel() === "Home event" ? "Home Assistant" : row?.sender || this.kindLabel();
  }
  kindLabel() {
    const row = this.row();
    const kind = row ? sourceReferenceKind(row) : this.reference().kind;
    return ({email: "Email", message: "Message", imessage: "Message", home: "Home event", ha: "Home event", calendar: "Calendar", recording: "Recording"} as Record<string,string>)[kind] ?? "Source";
  }
  private service = inject(SourcesService);
  private generation = 0;
  constructor() {
    effect(() => {
      const generation = ++this.generation;
      this.row.set(null); this.unavailable.set(false);
      void this.service.detail(this.reference().eventID).then(detail => {
        if (generation === this.generation) this.row.set(detail.row);
      }).catch(() => { if (generation === this.generation) this.unavailable.set(true); });
    });
  }
}
