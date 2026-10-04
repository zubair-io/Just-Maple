import { InteractivityChecker } from "@angular/cdk/a11y";
import { retainModalTab } from "./modal-keyboard";
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  ChangeDetectionStrategy,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { DatePipe } from "@angular/common";
import { MuiButtonComponent } from "@maple/ui";
import {
  SourcesService,
  SourceDetail,
  SourceTransition,
  SourceArtifactPage,
  SourceStage,
  sourceDate,
} from "./sources.service";
@Component({
  selector: "maple-source-detail",
  standalone: true,
  imports: [DatePipe, MuiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <dialog
    #drawer
    class="source-detail"
    aria-modal="true"
    (cancel)="$event.preventDefault(); close()"
    (keydown)="retainTab($event)"
    aria-label="Source details"
    tabindex="-1"
  >
    <header>
      <div>
        <span class="eyebrow">Original · state · history</span>
        <h2>{{ detail()?.row?.subject || "Source details" }}</h2>
      </div>
      <mui-button variant="ghost" (pressed)="close()">Close</mui-button>
    </header>
    @if (loading()) {
      <p role="status">Loading captured evidence…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <mui-button variant="ghost" (pressed)="load()">Try again</mui-button>
    }
    @if (detail(); as source) {
      <dl>
        <dt>Type</dt>
        <dd>{{ source.row.type }}</dd>
        <dt>Source / account</dt>
        <dd>
          {{ source.row.connector }} ·
          {{ source.row.account || "Local account" }}
        </dd>
        <dt>From</dt>
        <dd>{{ source.row.sender || "Not recorded" }}</dd>
        <dt>Observed</dt>
        <dd>{{ sourceDate(source.row.occurredAt) | date: "medium" }}</dd>
        <dt>Received</dt>
        <dd>{{ sourceDate(source.row.receivedAt) | date: "medium" }}</dd>
        @if (source.row.observedState) {
          <dt>Observed state</dt>
          <dd>{{ source.row.observedState }}</dd>
        }
        <dt>Processing</dt>
        <dd>{{ source.row.status }} · {{ source.row.statusDetail }}</dd>
        <dt>Revision</dt>
        <dd>{{ source.row.revision }}</dd>
      </dl>
      <p class="muted">
        Live details as of {{ sourceDate(source.asOf) | date: "medium" }}.
        Original entity state and processing progress are separate.
      </p>
      <div class="tabs" role="group" aria-label="Source views">
        @for (value of source.conversation ? conversationTabs : tabs; track value) {
          <button
            type="button"
            [attr.aria-pressed]="tab() === value"
            [attr.aria-controls]="'source-tab-' + value"
            (click)="tab.set(value)"
          >
            {{ value }}
          </button>
        }
      </div>
      <div role="region" [id]="'source-tab-' + tab()" tabindex="0">
        @switch (tab()) {
          @case ("Original") {
            <p class="muted">
              Captured source text. Direct opening in the original app is not
              available here.
            </p>
            @if (source.truncated) {
              <p role="status">This captured preview is shortened.</p>
            }
            <pre>{{ source.content || "No captured text is available." }}</pre>
            <details>
              <summary>Source identity</summary>
              <code>{{ source.row.id }}</code>
              <p>{{ source.row.externalID }}</p>
            </details>
          }
          @case ("Conversation") {
            @if (source.conversation; as conversation) {
              <p class="muted">{{ conversation.totalMessages }} messages in this captured conversation · {{ conversation.account }}.
                Latest captured revisions as of {{ sourceDate(conversation.asOf) | date: "medium" }}. Separate requests may still need attention.</p>
              @if (conversation.omittedMessages) {<p role="status">{{ conversation.omittedMessages }} earlier messages omitted. Showing up to 50 recent messages and the selected source.</p>}
              @for (message of conversation.messages; track message.eventID) {
                <article class="stage" [attr.aria-label]="message.selected ? 'Selected source message' : 'Conversation message'">
                  <strong>{{ message.sender || 'Sender not recorded' }}</strong>
                  <p>{{ message.direction === 'outgoing' ? 'Sent' : message.direction === 'incoming' ? 'Received' : 'Direction not recorded' }} · {{ sourceDate(message.occurredAt) | date: "medium" }}</p>
                  @if (message.selected) {<p>Selected source{{ message.historicalRevision ? ' · original historical revision' : '' }}</p>}
                  <pre>{{ message.content }}</pre>
                  @if (message.truncated) {<p class="muted">Excerpt shortened. Open this message to inspect its captured source.</p>}
                  <mui-button variant="ghost" (pressed)="openRelated(message.eventID)">Open this message</mui-button>
                </article>
              }
            }
          }
          @case ("Processing") {
            @for (stage of source.stages; track stage.stage) {
              <article class="stage">
                <div>
                  <strong>{{ stage.stage }}</strong
                  ><span class="state">{{ stage.state }}</span>
                </div>
                <p>{{ stage.reason || "No additional reason recorded." }}</p>
                @if (
                  stage.relatedEventID && stage.relatedEventID !== source.row.id
                ) {
                  <mui-button
                    variant="ghost"
                    (pressed)="openRelated(stage.relatedEventID)"
                    >{{
                      stage.state === "batched"
                        ? "Open HA batch"
                        : "Open representative source"
                    }} ↗</mui-button
                  >
                }
                @if (["failed", "blocked"].includes(stage.state)) {
                  <mui-button
                    variant="ghost"
                    [disabled]="retrying()"
                    (pressed)="retry(stage)"
                    >Retry {{ stage.stage }}</mui-button
                  >
                }
              </article>
            } @empty {
              <p>No processing stages recorded.</p>
            }
          }
          @case ("History") {
            @for (attempt of source.attempts || []; track attempt.id) {
              <article class="stage">
                <strong
                  >{{ attempt.stage }} ·
                  {{ attempt.provider || "Provider not recorded" }}
                  {{ attempt.model }}</strong
                >
                <p>
                  Transport: {{ attempt.transportOutcome }} · Application:
                  {{ attempt.commitOutcome }}
                </p>
                <small
                  >Started {{ sourceDate(attempt.startedAt) | date: "medium" }}
                  @if (attempt.endedAt !== undefined) { · Ended {{ sourceDate(attempt.endedAt) | date: "medium" }} }
                  @else { · End time not recorded }
                  · {{ attemptDuration(attempt.startedAt, attempt.endedAt) }}
                  · Attempt {{ attempt.id }}</small
                >
                @if (attempt.parentAttemptID) {
                  <small>Repair of {{ attempt.parentAttemptID }}</small>
                }
              </article>
            }
            <p class="muted">
              {{ historyCoverage(source.historyAvailability) }} Retained attempts stay visible after retries.
            </p>
            <ol class="audit">
              @for (item of history(); track item.sequence) {
                <li>
                  <time>{{ sourceDate(item.at) | date: "medium" }}</time
                  ><strong
                    >{{ item.stage }}:
                    {{ item.fromState ? item.fromState + " → " : ""
                    }}{{ item.toState }}</strong
                  >
                  @if (item.reason) {
                    <p>{{ item.reason }}</p>
                  }
                  @if (
                    item.relatedEventID && item.relatedEventID !== source.row.id
                  ) {
                    <mui-button
                      variant="ghost"
                      (pressed)="openRelated(item.relatedEventID)"
                      >{{
                        item.toState === "batched"
                          ? "Open HA batch"
                          : "Open representative source"
                      }} ↗</mui-button
                    >
                  }
                  @for (artifact of item.artifacts || []; track artifact.id) {
                    <mui-button
                      variant="ghost"
                      (pressed)="
                        tab.set('Responses'); openArtifact(artifact.id)
                      "
                      >{{ artifact.kind }} · {{ artifact.provider }}</mui-button
                    >
                  }
                  @if (item.attemptID) {
                    <small>Attempt {{ item.attemptID }}</small>
                  }
                </li>
              } @empty {
                <li>No transitions were recorded for this source.</li>
              }
            </ol>
            @if (historyLoading()) { <p role="status">Loading earlier history…</p> }
            @if (nextHistory() !== undefined) {
              <mui-button variant="ghost" [disabled]="historyLoading()" (pressed)="moreHistory()"
                >Earlier history</mui-button
              >
            }
          }
          @case ("Responses") {
            <p class="muted">
              Actual saved provider responses and submitted context. Missing
              legacy artifacts are not reconstructed.
            </p>
            @for (item of source.artifacts; track item.id) {
              <button
                class="artifact"
                type="button"
                (click)="openArtifact(item.id)"
              >
                <strong>{{ item.stage }} · {{ item.kind }}</strong
                ><span
                  >{{ item.provider }} {{ item.model }} ·
                  {{ item.availability }} · {{ item.byteCount }} bytes{{
                    item.legacy ? " · Legacy latest only" : ""
                  }}</span
                >
              </button>
            } @empty {
              <p>No provider responses were retained for this source.</p>
            }
            @if (artifactLoading()) {
              <p role="status">Loading response…</p>
            }
            @if (artifact(); as payload) {
              <p>
                {{ payload.availability }} · {{ payload.totalBytes }} bytes{{
                  payload.complete && payload.offset === 0
                    ? ""
                    : " · Partial view"
                }}
              </p>
              <pre>{{ payload.content }}</pre>
              @if (payload.nextOffset !== undefined) {
                <mui-button variant="ghost" (pressed)="moreArtifact()"
                  >Next response section</mui-button
                >
              }
            }
          }
        }
      </div>
      @if (actionStatus()) {
        <p role="status">{{ actionStatus() }}</p>
      }
      @if (source.relatedRevisions.length) {
        <section aria-label="Related source revisions">
          <h3>Related revisions</h3>
          <p class="muted">
            Other captured observations of this same source entity.
          </p>
          @for (
            revisionID of source.relatedRevisions;
            track revisionID;
            let index = $index
          ) {
            @if (revisionID !== source.row.id) {
              <mui-button variant="ghost" (pressed)="openRelated(revisionID)"
                >Open related revision {{ index + 1 }} ↗</mui-button
              >
            }
          }
        </section>
      }
      @if (source.backlinks?.length) {
        <section aria-label="Notes referencing this source">
          <h3>In your notes</h3>
          @for (link of source.backlinks; track link.blockID) {
            <mui-button variant="ghost" (pressed)="openBacklink(link)"
              >{{ link.path }} ↗</mui-button
            >
          }
        </section>
      }
      @if (allowInsert()) {
        <mui-button (pressed)="inserted.emit(source.row.id)"
          >Add reference to note</mui-button
        >
      }
    }
  </dialog>`,
  styles: [
    `
      :host {
        display: block;
      }
      .source-detail {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-bg-secondary);
        padding: 24px;
        position: fixed;
        inset: 0 0 0 auto;
        margin: 0;
        width: min(680px, 94vw);
        max-width: none;
        height: 100dvh;
        max-height: none;
        box-sizing: border-box;
        overflow: auto;
        color: var(--color-text-main);
        box-shadow: var(--shadow-lg, 0 12px 40px #0003);
      }
      .source-detail::backdrop {
        background: var(--color-overlay, #0005);
      }
      header,
      header > div,
      .stage > div {
        display: flex;
        gap: 16px;
      }
      header {
        justify-content: space-between;
        align-items: start;
      }
      header > div {
        display: block;
      }
      h2 {
        font: 24px var(--font-serif);
        margin: 8px 0 20px;
        overflow-wrap: anywhere;
      }
      .eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--color-text-muted);
      }
      dl {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 9px;
        font-size: 13px;
      }
      dt,
      .muted,
      time,
      small {
        color: var(--color-text-muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .tabs {
        display: flex;
        gap: 8px;
        border-bottom: 1px solid var(--color-border);
        margin: 24px 0 18px;
      }
      .tabs button,
      .artifact {
        border: 0;
        background: transparent;
        color: var(--color-text-main);
        font: inherit;
        cursor: pointer;
        padding: 12px;
      }
      .tabs button[aria-pressed="true"] {
        border-bottom: 2px solid var(--color-primary);
        color: var(--color-link, var(--color-primary));
      }
      button:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 440px;
        overflow: auto;
        font: 13px/1.6 var(--font-mono);
        padding: 16px;
        background: var(--color-bg);
        user-select: text;
      }
      .stage {
        padding: 16px 0;
        border-bottom: 1px solid var(--color-border);
      }
      .state {
        color: var(--color-link, var(--color-primary));
      }
      .audit {
        padding-left: 24px;
        border-left: 2px solid var(--color-border);
        list-style: none;
      }
      .audit li {
        padding: 12px 0;
      }
      .audit strong,
      .audit time,
      .artifact span {
        display: block;
        margin: 4px 0;
      }
      .artifact {
        display: block;
        width: 100%;
        text-align: left;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        margin: 8px 0;
      }
      .artifact span {
        font-size: 12px;
        color: var(--color-text-muted);
      }
      @media (max-width: 600px) {
        .source-detail {
          padding: 14px;
          width: 100vw;
          border-radius: 0;
        }
        .tabs {
          gap: 0;
          flex-wrap: wrap;
        }
        dl {
          grid-template-columns: 90px 1fr;
        }
      }
    `,
  ],
})
export class SourceDetailComponent implements AfterViewInit, OnDestroy {
  @ViewChild('drawer', { static: true }) private drawer!: ElementRef<HTMLDialogElement>;
  private readonly checker = inject(InteractivityChecker);
  retainTab(event: KeyboardEvent) { retainModalTab(this.drawer.nativeElement, event, this.checker); }
  private opener: HTMLElement | null = null;
  private disposed = false;
  private restored = false;
  private navigating = false;
  ngAfterViewInit() {
    const dialog = this.drawer.nativeElement;
    const active = dialog.ownerDocument.activeElement;
    this.opener = active instanceof HTMLElement && active !== dialog.ownerDocument.body && !dialog.contains(active) ? active : null;
    // Only the explicit inspector mount acquires focus. Source loads/retries never do.
    queueMicrotask(() => {
      if (this.disposed || !dialog.isConnected) return;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
    });
  }
  close() {
    this.dismiss(true);
    this.closed.emit();
  }
  private dismiss(restore: boolean) {
    const dialog = this.drawer?.nativeElement;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    if (restore && !this.restored) {
      this.restored = true;
      if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    }
  }
  ngOnDestroy() {
    this.disposed = true;
    this.generation++;
    this.artifactGeneration++;
    this.dismiss(!this.navigating);
  }
  private async navigate(commands: string[], extras?: { queryParamsHandling: 'preserve' } | { queryParams: { document: string } }) {
    if (this.navigating) return;
    this.navigating = true;
    try {
      const opened = await this.router.navigate(commands, extras);
      if (!opened && !this.disposed) this.actionStatus.set('Your current note is still open. Resolve its save error before leaving.');
    } catch {
      if (!this.disposed) this.actionStatus.set('Could not open that destination. Your source remains available here.');
    } finally { if (!this.disposed) this.navigating = false; }
  }
  readonly router = inject(Router);
  readonly sourceDate = sourceDate;
  readonly eventID = input.required<string>();
  readonly allowInsert = input(false);
  readonly closed = output<void>();
  readonly inserted = output<string>();
  readonly service = inject(SourcesService);
  readonly detail = signal<SourceDetail | null>(null);
  readonly history = signal<SourceTransition[]>([]);
  readonly historyLoading = signal(false);
  historyCoverage(value: string) {
    if (value === 'recorded_since_ingestion') return 'History recorded since this source was ingested.';
    if (value === 'legacy_latest_only_before_audit') return 'Historical attempt detail was not recorded before audit logging began.';
    return 'Historical coverage is not recorded.';
  }
  attemptDuration(start: string | number, end?: string | number) {
    if (end === undefined) return 'Duration unavailable';
    const from = new Date(sourceDate(start)).getTime(), to = new Date(sourceDate(end)).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 'Duration unavailable';
    const ms = Math.round(to - from);
    if (ms < 1000) return `Duration ${ms} ms`;
    if (ms < 60_000) return `Duration ${(ms / 1000).toFixed(1)} s`;
    const seconds = Math.floor(ms / 1000);
    return `Duration ${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }
  readonly nextHistory = signal<number | undefined>(undefined);
  readonly artifact = signal<SourceArtifactPage | null>(null);
  readonly artifactLoading = signal(false);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly actionStatus = signal("");
  readonly retrying = signal(false);
  readonly tabs = ["Original", "Processing", "History", "Responses"];
  readonly conversationTabs = ["Original", "Conversation", "Processing", "History", "Responses"];
  readonly tab = signal("Original");
  private generation = 0;
  private artifactGeneration = 0;
  private retryCommands = new Map<string, string>();
  constructor() {
    effect(() => {
      this.eventID();
      void this.load();
    });
  }
  openRelated(eventID: string) {
    return this.navigate(["/sources", eventID], {
      queryParamsHandling: "preserve",
    });
  }
  openBacklink(link: { documentID: string; day?: string }) {
    if (link.day)
      return this.navigate(["/daily", link.day]);
    else
      return this.navigate(["/notebooks"], {
        queryParams: { document: link.documentID },
      });
  }
  async load() {
    const eventID = this.eventID(),
      generation = ++this.generation;
    this.artifactGeneration++;
    this.detail.set(null);
    this.history.set([]);
    this.historyLoading.set(false);
    this.nextHistory.set(undefined);
    this.artifactLoading.set(false);
    this.artifact.set(null);
    this.loading.set(true);
    this.error.set("");
    this.actionStatus.set("");
    try {
      const detail = await this.service.detail(eventID, true);
      if (generation !== this.generation) return;
      this.detail.set(detail);
      const history = await this.service.history(eventID);
      if (generation !== this.generation) return;
      this.history.set(history.items);
      this.nextHistory.set(history.nextSequence);
    } catch (e) {
      if (generation === this.generation)
        this.error.set(
          e instanceof Error ? e.message : "Source details are unavailable.",
        );
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  async moreHistory() {
    if (this.disposed || this.loading() || this.historyLoading() || this.nextHistory() === undefined) return;
    const generation = this.generation;
    this.historyLoading.set(true);
    this.actionStatus.set('');
    try {
      const result = await this.service.history(
        this.eventID(),
        this.nextHistory(),
      );
      if (generation !== this.generation) return;
      this.history.update((v) => [
        ...new Map(
          [...v, ...result.items].map((item) => [item.sequence, item]),
        ).values(),
      ]);
      this.nextHistory.set(result.nextSequence);
    } catch {
      if (generation === this.generation) this.actionStatus.set("Earlier history could not be loaded. Try Earlier history again.");
    } finally {
      if (generation === this.generation) this.historyLoading.set(false);
    }
  }
  async openArtifact(id: string, offset = 0) {
    const generation = ++this.artifactGeneration,
      eventID = this.eventID();
    this.artifactLoading.set(true);
    this.artifact.set(null);
    try {
      const value = await this.service.artifact(eventID, id, offset);
      if (generation === this.artifactGeneration) this.artifact.set(value);
    } catch {
      if (generation === this.artifactGeneration)
        this.actionStatus.set("This response could not be loaded.");
    } finally {
      if (generation === this.artifactGeneration)
        this.artifactLoading.set(false);
    }
  }
  moreArtifact() {
    const item = this.artifact();
    if (item?.nextOffset !== undefined)
      void this.openArtifact(item.id, item.nextOffset);
  }
  async retry(stage: SourceStage) {
    if (this.retrying()) return;
    const eventID = this.eventID(), generation = this.generation;
    this.retrying.set(true);
    const key = `${this.eventID()}:${stage.stage}:${stage.version}`;
    const commandID = this.retryCommands.get(key) ?? crypto.randomUUID();
    this.retryCommands.set(key, commandID);
    try {
      const result = await this.service.retry(
        this.eventID(),
        stage.stage,
        stage.version,
        commandID,
      );
      if (this.disposed || eventID !== this.eventID() || generation !== this.generation) return;
      await this.load();
      if (!this.disposed && eventID === this.eventID() && generation + 1 === this.generation) this.actionStatus.set(result.status);
    } catch (e) {
      if (!this.disposed && eventID === this.eventID() && generation === this.generation) this.actionStatus.set(
        e instanceof Error ? e.message : "Retry was not acknowledged.",
      );
    } finally {
      this.retrying.set(false);
    }
  }
}
