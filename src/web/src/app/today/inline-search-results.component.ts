import { DatePipe } from "@angular/common";
import { Component, ChangeDetectionStrategy, DestroyRef, effect, inject, input, output, signal } from "@angular/core";
import { NativeBridge } from "../core/native-bridge.service";
import { SourceReference } from "../editor/daily-markdown-codec";
import { sourceReferenceKind } from "../sources/source-reference-kind";

export interface InlineSearchCursor { runID: string; offset: number; fingerprint: string }
export interface InlineSearchItem {
  eventID: string; availability: "available" | "missing"; reason?: string;
  type?: string; connector?: string; account?: string; title?: string; excerpt?: string;
  occurredAt?: number | string; receivedAt?: number | string;
}
export interface InlineSearchPage {
  schemaVersion: 1; runID: string; availability: "available" | "not_recorded"; message?: string;
  intent?: { type: string; sender?: string; query?: string };
  items: InlineSearchItem[]; total: number; capturedCount: number; offset: number;
  nextCursor?: InlineSearchCursor; hasMoreMatches: boolean; asOf: string | number;
}

@Component({
  selector: "maple-inline-search-results",
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" (click)="toggle()" [attr.aria-expanded]="expanded()">{{ expanded() ? 'Hide matching sources' : 'Browse matching sources' }}</button>
    @if (expanded()) {
      <section aria-label="Matching sources">
        @if (loading()) { <p role="status">Loading matching sources…</p> }
        @if (error()) { <p role="alert">{{ error() }}</p><button type="button" (click)="retry()" [disabled]="loading()">Retry results</button> }
        @if (page(); as results) {
          @if (results.availability === 'available') {
            <p>{{ results.total }} matches · {{ results.items.length ? results.offset + 1 : 0 }}–{{ results.offset + results.items.length }} shown
              · Captured {{ date(results.asOf) | date:'medium' }}</p>
            <p class="hint">These are the original search results. Browsing pages does not ask Maple again.</p>
            @if (!results.items.length) { <p>No matching sources were captured.</p> }
            <ul>
              @for (item of results.items; track item.eventID) {
                <li>
                  @if (item.availability === 'available') {
                    <button class="title" type="button" (click)="inspected.emit(item.eventID)">{{ item.title || 'Open source' }}</button>
                    <span class="hint">{{ item.connector }} @if (item.account) { · {{ item.account }} }</span>
                    <p class="excerpt">{{ item.excerpt }}</p>
                    <button type="button" [disabled]="!canInsert() || loading()" (click)="insert(item)">Add to note</button>
                  } @else { <p>{{ item.reason || 'This captured source is no longer available.' }}</p> }
                </li>
              }
            </ul>
            <nav aria-label="Search result pages">
              <button type="button" [disabled]="loading() || !previous().length" (click)="back()">Previous results</button>
              <button type="button" [disabled]="loading() || !results.nextCursor" (click)="next()">Next results</button>
            </nav>
          }
          @if (results.message) { <p role="status">{{ results.message }}</p> }
        }
      </section>
    }
  `,
  styles: [`
    :host { display:block; margin:10px 0; font-family:var(--font-sans); }
    section { margin-top:10px; padding:12px; border:1px solid var(--color-border); border-radius:8px; }
    button { border:1px solid var(--color-border); border-radius:6px; padding:6px 10px; background:var(--color-bg); color:var(--color-text-main); cursor:pointer; }
    button:disabled { opacity:.5; cursor:default; } button:focus-visible { outline:2px solid var(--color-primary); outline-offset:3px; }
    ul { padding:0; list-style:none; } li { padding:12px 0; border-bottom:1px solid var(--color-border); }
    p { margin:6px 0; } .hint { display:block; color:var(--color-text-muted); font-size:12px; }
    .title { border:0; padding:0; text-align:left; text-decoration:underline; overflow-wrap:anywhere; }
    .excerpt { white-space:pre-wrap; font-size:13px; overflow-wrap:anywhere; }
    nav { display:flex; gap:8px; margin-top:12px; }
  `],
})
export class InlineSearchResultsComponent {
  readonly runID = input.required<string>();
  readonly canInsert = input(false);
  readonly inspected = output<string>();
  readonly insertRequested = output<SourceReference>();
  readonly expanded = signal(false);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly page = signal<InlineSearchPage | null>(null);
  readonly previous = signal<(InlineSearchCursor | undefined)[]>([]);
  private readonly bridge = inject(NativeBridge);
  private generation = 0;
  private currentCursor?: InlineSearchCursor;
  private requestedCursor?: InlineSearchCursor;
  private requestedHistory: (InlineSearchCursor | undefined)[] = [];
  constructor() {
    inject(DestroyRef).onDestroy(() => { this.generation++; });
    effect(() => {
      this.runID(); this.generation++;
      this.expanded.set(false); this.page.set(null); this.error.set("");
      this.loading.set(false); this.previous.set([]); this.currentCursor = undefined;
    });
  }
  date(value: number | string) { return typeof value === "number" ? value * 1000 : value; }
  toggle() {
    this.expanded.update(value => !value);
    if (this.expanded() && !this.page() && !this.loading()) void this.load();
  }
  next() {
    const cursor = this.page()?.nextCursor;
    if (!cursor || this.loading()) return;
    void this.load(cursor, [...this.previous(), this.currentCursor]);
  }
  back() {
    if (!this.previous().length || this.loading()) return;
    const history = [...this.previous()], cursor = history.pop();
    void this.load(cursor, history);
  }
  retry() { if (!this.loading()) void this.load(this.requestedCursor, this.requestedHistory); }
  private async load(cursor?: InlineSearchCursor, history: (InlineSearchCursor | undefined)[] = []) {
    const generation = ++this.generation, runID = this.runID();
    this.requestedCursor = cursor; this.requestedHistory = history;
    this.loading.set(true); this.error.set("");
    try {
      const result = await this.bridge.notebook<InlineSearchPage>("mapleSearchPage", { runID, ...(cursor ? { cursor } : {}) });
      if (generation !== this.generation || this.runID() !== runID) return;
      if (result.schemaVersion !== 1 || result.runID !== runID || result.items.length > 25 || result.offset !== (cursor?.offset ?? 0))
        throw Error("The saved search page could not be verified. Retry the results.");
      this.page.set(result); this.previous.set(history); this.currentCursor = cursor;
    } catch (error) {
      if (generation === this.generation) this.error.set(error instanceof Error ? error.message : "Matching sources are unavailable. Retry the results.");
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
  insert(item: InlineSearchItem) {
    if (!this.canInsert() || item.availability !== "available") return;
    this.insertRequested.emit({ v: 1, eventID: item.eventID,
      kind: sourceReferenceKind({ connector: item.connector ?? "", type: item.type ?? "" }), label: item.title || "Source" });
  }
}
