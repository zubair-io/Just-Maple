import { sourceReferenceKind } from "../sources/source-reference-kind";
import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription, combineLatest } from "rxjs";
import { MuiButtonComponent } from "@maple/ui";
import { TodayDocumentService } from "./today-document.service";
import { relativeDayLabel } from "./relative-day";
import { localDay, offsetDay } from "../daily-note/daily-note.models";
import { MapleEditorComponent } from "../editor/maple-editor.component";
import {
  SourcesService,
  SourceRow,
  emptySourceQuery,
} from "../sources/sources.service";
import { SourceDetailComponent } from "../sources/source-detail.component";
@Component({
  selector: "maple-today",
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MuiButtonComponent,
    MapleEditorComponent,
    SourceDetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <section class="today-page">
    <header class="note-date">
      <time
        class="date-chip"
        [attr.datetime]="notes.day()"
        [attr.title]="formattedDay()"
        [attr.aria-label]="formattedDay()"
        >{{ relativeDay() }}</time
      >
    </header>
    @if (currentDay() !== openedOnDay() && notes.day() !== currentDay()) {
      <p class="document-notice">
        It is now {{ currentDay() }}. This note stays on {{ notes.day() }} while
        you write.
        <mui-button
          variant="ghost"
          (pressed)="router.navigate(['/today', currentDay()])"
          >Open today’s note</mui-button
        >
      </p>
    }
    @if (notes.error()) {
      <div class="document-error" role="alert">
        <p>{{ notes.error() }}</p>
        <mui-button variant="ghost" (pressed)="notes.flush()"
          >Retry save</mui-button
        ><mui-button variant="ghost" (pressed)="notes.recoveryCopy()"
          >Save recovery copy</mui-button
        ><mui-button variant="ghost" (pressed)="notes.reopen()"
          >Reopen current file · retain draft</mui-button
        >
        <p class="small">
          Your Markdown stays available in the editor below. Copy it before
          closing if saving remains unavailable.
        </p>
      </div>
    }
    @if (notes.document()?.warning) {
      <p class="document-notice" role="status">
        {{ notes.document()?.warning }}
      </p>
    }
    @if (notes.document()?.legacyMigrationAvailable) {
      <section class="document-notice">
        <p>
          Earlier blocks need an explicit import before this day can become a
          Markdown document. Review the preview below; existing files will not
          be overwritten.
        </p>
        <mui-button variant="ghost" (pressed)="notes.migrate()"
          >Import preview into this day</mui-button
        ><mui-button variant="ghost" (pressed)="notes.migrate(true)"
          >Import as a recovery note</mui-button
        >
      </section>
    }
    @if (notes.document(); as doc) {
      @if (doc.readOnly) {
        <p class="document-notice">
          Read-only workspace. Edits have not been acknowledged by the Mac.
        </p>
      }
      @for (generation of [notes.generation()]; track generation) {
        <maple-editor
          #editor
          [initial]="notes.initial()"
          [documentID]="doc.documentID"
          [showToolbar]="true"
          [documentToolsAvailable]="true"
          [dayTransfersAvailable]="true"
          [readOnly]="doc.readOnly || notes.actionBusy()"
          (changed)="notes.change($event)"
          (editingChanged)="notes.setEditing($event)"
          (inspected)="selected.set($event)"
          (submitted)="notes.submit($event.blockID, $event.text)"
          (sourceRequested)="openPicker()"
          (clearRequested)="notes.blockAction($event, 'clear')"
          (blockTransferRequested)="transferBlock($event)"
          (documentToolsRequested)="openDocumentTools()"
        />
      }
      @if (toolsOpen()) {
        <dialog
          #documentTools
          class="document-tools-drawer"
          aria-labelledby="document-tools-title"
          (cancel)="$event.preventDefault(); closeDocumentTools()"
        >
          <header>
            <h2 id="document-tools-title">Document tools</h2>
            <mui-button variant="ghost" (pressed)="closeDocumentTools()"
              >Close document tools</mui-button
            >
          </header>
          <p class="small">{{ doc.path }} · Preserved history and recovery</p>
          <div class="document-tool-actions">
            <mui-button
              variant="ghost"
              (pressed)="toggleMarkdown(); closeDocumentTools()"
              >{{
                editorInstance?.source() ? "Formatted view" : "View Markdown"
              }}</mui-button
            >
            <mui-button variant="ghost" (pressed)="notes.recoveryCopy()"
              >Save recovery copy</mui-button
            >
            <mui-button variant="ghost" (pressed)="notes.reopen()"
              >Reopen current file · retain draft</mui-button
            >
          </div>
          @if (notes.automaticStatus()) {
            <p class="small" role="status">{{ notes.automaticStatus() }}</p>
          }
          <p class="small">
            Clearing a block hides it from this note. It does not complete a
            linked task.
          </p>
          @if (doc.cleared?.length) {
            <h2>Cleared from this day</h2>
            @for (block of doc.cleared; track block.blockID) {
              <article class="managed-block">
                <p>{{ blockLabel(block.content, block.kind) }}</p>
                <mui-button
                  variant="ghost"
                  [disabled]="notes.actionBusy() || doc.readOnly"
                  (pressed)="notes.blockAction(block.blockID, 'restore')"
                  >Restore block</mui-button
                >
              </article>
            }
          }
          <mui-button variant="ghost" (pressed)="notes.loadHistory()"
            >Load document history</mui-button
          >
          @for (
            operation of notes.operations();
            track operation.input.commandID
          ) {
            <details class="revision">
              <summary>
                {{ operation.input.kind }} · {{ operation.state }}
              </summary>
              @if (
                operation.state === "prepared" || operation.state === "conflict"
              ) {
                <p class="small">
                  This action is not finalized. A linked task remains pending
                  until recovery resolves it.
                </p>
                <mui-button
                  variant="ghost"
                  (pressed)="
                    notes.resolveOperation(operation.input.commandID, 'retry')
                  "
                  >Retry recovery</mui-button
                ><mui-button
                  variant="ghost"
                  (pressed)="
                    notes.resolveOperation(operation.input.commandID, 'abandon')
                  "
                  >Abandon pending action · keep current files</mui-button
                >
              }
              @for (file of operation.files; track file.documentID) {
                <details>
                  <summary>Preserved document {{ file.documentID }}</summary>
                  <pre>{{ file.after }}</pre>
                </details>
              }
            </details>
          }
          @for (entry of notes.history(); track entry.commandID) {
            <details class="revision">
              <summary>
                {{ entry.createdAt * 1000 | date: "medium" }} ·
                {{ entry.state }}
              </summary>
              <pre>{{ entry.after }}</pre>
              <mui-button
                variant="ghost"
                (pressed)="notes.recoveryCopy(entry.after)"
                >Save this revision as a recovery copy</mui-button
              >
            </details>
          }
        </dialog>
      }
      @if (notes.run(); as run) {
        <section
          class="maple-run"
          aria-label="Maple request status"
          aria-live="polite"
        >
          <strong>Maple · {{ run.status.replaceAll("_", " ") }}</strong>
          @if (run.coverage) {
            <p>{{ run.coverage }}</p>
          }
          @if (run.hasMore) {
            <mui-button
              variant="ghost"
              (pressed)="router.navigate(['/sources'])"
              >View all in Sources</mui-button
            >
          }
          @if (run.status === "queued" || run.status === "running") {
            <mui-button variant="ghost" (pressed)="notes.cancelRun()"
              >Cancel request</mui-button
            >
          }
          @if (
            (run.status === "failed" ||
              run.status === "canceled" ||
              run.status === "configuration_required") &&
            run.request?.text
          ) {
            <mui-button variant="ghost" (pressed)="notes.retryRun()"
              >Retry request</mui-button
            >
          }
          @if (run.error) {
            <p>{{ run.error }}</p>
          }
          @if (run.text) {
            <p>{{ run.text }}</p>
          }
          @if (run.status === "succeeded" && notes.dirty()) {
            <p>
              Your reply was saved on the Mac while you were editing. Your draft
              is retained; save or resolve this revision before reopening.
            </p>
          }
          @if (run.status === "unapplied") {
            <p>
              The request anchor changed. The response is retained and was not
              inserted over your writing.
            </p>
            <mui-button variant="ghost" (pressed)="notes.insertReply()"
              >Retry anchored insertion</mui-button
            >
          }
          @if (run.eventIDs?.length) {
            <div class="run-evidence">
              @for (id of run.eventIDs; track id) {
                <button type="button" (click)="selected.set(id)">
                  Inspect evidence ↗
                </button>
              }
            </div>
          }
          <mui-button variant="ghost" (pressed)="notes.loadAttempts()"
            >Inspect Maple’s inputs & responses</mui-button
          >
          @for (attempt of notes.attempts(); track attempt.attemptID) {
            <details class="revision">
              <summary>
                {{ attempt.stage }} · {{ attempt.provider }}
                {{ attempt.model }} · {{ attempt.status }}
              </summary>
              <p>Validation: {{ attempt.validationOutcome }}</p>
              <h3>Submitted input</h3>
              <pre>{{ attempt.input }}</pre>
              <h3>Response</h3>
              <pre>{{
                attempt.response || "No successful response retained."
              }}</pre>
              @if (attempt.error) {
                <p>{{ attempt.error }}</p>
              }
            </details>
          }
        </section>
      }
      @if (notes.runs().length > 1) {
        <details class="document-organizer">
          <summary>Earlier Maple requests</summary>
          @for (run of notes.runs(); track run.runID) {
            <mui-button variant="ghost" (pressed)="notes.selectRun(run)"
              >{{ run.status }} · {{ run.requestBlockID }}</mui-button
            >
          }
        </details>
      }
    }
    @if (picker()) {
      <section class="source-picker" aria-label="Add source reference">
        <header>
          <h2>Add source material</h2>
          <mui-button variant="ghost" (pressed)="picker.set(false)"
            >Close</mui-button
          >
        </header>
        <form (ngSubmit)="searchSources()">
          <label
            >Search your captured sources<input
              name="query"
              type="search"
              [(ngModel)]="sourceSearch"
              placeholder="Sender, subject or content" /></label
          ><button type="submit">Search</button>
        </form>
        @if (pickerError()) {
          <p role="alert">{{ pickerError() }}</p>
        }
        @for (row of matches(); track row.id) {
          <button type="button" class="picker-row" (click)="insertSource(row)">
            <strong>{{ row.subject || row.sender || row.type }}</strong
            ><small
              >{{ row.type }} · {{ row.connector }} · {{ row.sender }}</small
            >
          </button>
        } @empty {
          <p>
            {{
              pickerLoading()
                ? "Loading sources…"
                : "No matching sources. Try another search or connect a source."
            }}
          </p>
        }
        <p class="small">
          Showing up to 60 matches. Use Sources for filters and complete
          history.
        </p>
      </section>
    }
    @if (selected(); as id) {
      <maple-source-detail [eventID]="id" (closed)="selected.set(null)" />
    }
    <footer class="document-footer">
      <span class="legend writing">Your writing</span
      ><span class="legend source">Source material</span
      ><span class="legend maple">Maple’s replies</span>
      <p>One day. One document. Write anywhere · @maple to ask inline.</p>
    </footer>
  </section>`,
  styles: [
    `
      :host {
        display: block;
      }
      .today-page {
        max-width: 940px;
        margin: auto;
      }
      .document-tools-drawer {
        position: fixed;
        inset: 0 0 0 auto;
        margin: 0;
        width: min(540px, 100vw);
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        box-sizing: border-box;
        padding: 28px;
        overflow: auto;
        border: 0;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        color: var(--color-text-main);
        font: 14px/1.6 var(--font-sans);
      }
      .document-tools-drawer::backdrop {
        background: #0005;
      }
      .document-tools-drawer > header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .document-tools-drawer h2 {
        font: 25px/1.3 var(--font-serif);
      }
      .document-tool-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .note-date {
        margin: 8px 0 28px;
      }
      .date-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        background: var(--color-bg-secondary);
        color: var(--color-text-main);
        font: 13px/1.5 var(--font-sans);
      }
      .date-chip::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--color-writing, var(--color-primary));
      }
      .document-error,
      .document-notice {
        padding: 14px 18px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        margin: 16px 0;
        font: 14px/1.6 var(--font-sans);
      }
      .document-error {
        border-color: var(--color-danger);
        color: var(--color-danger);
      }
      .document-notice {
        color: var(--color-text-muted);
      }
      .document-notice button,
      .run-evidence button {
        color: var(--color-link, var(--color-primary));
        font: inherit;
        border: 0;
        background: none;
        text-decoration: underline;
        cursor: pointer;
      }
      .small {
        font-size: 12px;
        color: var(--color-text-muted);
      }
      .document-organizer {
        font: 13px/1.6 var(--font-sans);
        margin: 24px 0;
        padding: 16px 0;
        border-top: 1px solid var(--color-border);
      }
      .document-organizer summary {
        cursor: pointer;
        color: var(--color-text-muted);
      }
      .managed-block {
        padding: 12px 0;
        border-bottom: 1px solid var(--color-border);
      }
      .managed-block p {
        overflow-wrap: anywhere;
      }
      .managed-block > div {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .revision {
        margin: 12px 0;
      }
      .revision pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 12px/1.6 var(--font-mono);
        max-height: 360px;
        overflow: auto;
      }
      .source-picker {
        padding: 24px;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        margin: 20px 0;
      }
      .source-picker header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .source-picker h2 {
        font: 24px var(--font-serif);
      }
      .source-picker form {
        display: flex;
        align-items: end;
        gap: 12px;
        margin-bottom: 20px;
      }
      .source-picker label {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
        flex: 1;
      }
      .source-picker input,
      .source-picker form > button {
        padding: 11px 12px;
        border-radius: 6px;
        border: 1px solid var(--color-border);
        background: var(--color-bg);
        color: var(--color-text-main);
        font: 14px var(--font-sans);
      }
      .picker-row {
        display: block;
        width: 100%;
        text-align: left;
        border: 0;
        border-bottom: 1px solid var(--color-border);
        padding: 16px 0;
        background: transparent;
        color: var(--color-text-main);
        cursor: pointer;
        font: 14px var(--font-sans);
      }
      .picker-row small {
        display: block;
        color: var(--color-text-muted);
        margin-top: 6px;
      }
      .maple-run {
        padding: 20px 24px;
        border-left: 3px solid var(--color-agent, var(--color-primary));
        background: var(--color-bg-secondary);
        font-size: 14px;
        line-height: 1.6;
      }
      .maple-run p {
        white-space: pre-wrap;
      }
      .run-evidence {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .document-footer {
        font: 12px/1.8 var(--font-sans);
        color: var(--color-text-muted);
        margin: 40px 0 20px;
        padding-bottom: 100px;
      }
      .legend {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-right: 20px;
      }
      .legend:before {
        content: "";
        width: 20px;
        height: 3px;
        background: var(--color-primary);
      }
      .legend.source:before {
        background: var(--color-info, var(--color-primary));
      }
      .legend.maple:before {
        background: var(--color-agent, var(--color-primary));
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
        outline-offset: 2px;
      }
      @media (max-width: 650px) {
        .document-organizer {
          font: 13px/1.6 var(--font-sans);
          margin: 24px 0;
          padding: 16px 0;
          border-top: 1px solid var(--color-border);
        }
        .document-organizer summary {
          cursor: pointer;
          color: var(--color-text-muted);
        }
        .managed-block {
          padding: 12px 0;
          border-bottom: 1px solid var(--color-border);
        }
        .managed-block p {
          overflow-wrap: anywhere;
        }
        .managed-block > div {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .revision {
          margin: 12px 0;
        }
        .revision pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font: 12px/1.6 var(--font-mono);
          max-height: 360px;
          overflow: auto;
        }
        .source-picker {
          padding: 14px;
        }
      }
    `,
  ],
})
export class TodayComponent implements OnInit, OnDestroy {
  readonly notes = inject(TodayDocumentService);
  readonly currentDay = signal(localDay());
  readonly openedOnDay = signal(localDay());
  readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly sources = inject(SourcesService);
  readonly selected = signal<string | null>(null);
  readonly picker = signal(false);
  readonly toolsOpen = signal(false);
  private toolsDialog?: HTMLDialogElement;
  @ViewChild("documentTools") set documentTools(
    value: ElementRef<HTMLDialogElement> | undefined,
  ) {
    this.toolsDialog = value?.nativeElement;
    if (this.toolsDialog) {
      const dialog = this.toolsDialog;
      queueMicrotask(() => {
        if (!this.toolsOpen() || !dialog.isConnected) return;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      });
    }
  }
  openDocumentTools() {
    this.toolsOpen.set(true);
    void this.notes.loadHistory();
  }
  closeDocumentTools() {
    if (this.toolsDialog?.open && typeof this.toolsDialog.close === "function")
      this.toolsDialog.close();
    this.toolsOpen.set(false);
  }
  transferBlock(event: { blockID: string; kind: "move" | "copy" }) {
    return this.notes.blockAction(event.blockID, event.kind, this.tomorrow());
  }
  readonly matches = signal<SourceRow[]>([]);
  readonly pickerLoading = signal(false);
  readonly pickerError = signal("");
  readonly tomorrow = () => offsetDay(this.notes.day(), 1);
  sourceSearch = "";
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private pickerGeneration = 0;
  private destroyed = false;
  @ViewChild("editor") set editor(value: MapleEditorComponent | undefined) {
    this.editorInstance = value;
    if (value && this.notes.pendingSource()) {
      const id = this.notes.pendingSource()!;
      queueMicrotask(() => void this.insertPending(id));
    }
  }
  protected editorInstance?: MapleEditorComponent;
  ngOnInit() {
    this.subscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, query]) => {
      const documentID = query.get("document");
      if (documentID) void this.notes.openDocument(documentID);
      else void this.notes.open(params.get("date") ?? localDay());
    });
    this.timer = setInterval(() => {
      this.currentDay.set(localDay());
      void this.notes.pollRun();
      void this.notes.pollAutomatic();
    }, 2000);
  }
  relativeDay() {
    return relativeDayLabel(this.notes.day(), this.currentDay());
  }
  toggleMarkdown() {
    this.editorInstance?.toggleSource();
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.editorInstance = undefined;
    this.notes.cancelPendingReads();
    this.subscription?.unsubscribe();
    clearInterval(this.timer);
    this.pickerGeneration++;
  }
  blockLabel(content: string, kind: string) {
    return (
      content
        .replace(/<!--[^]*?-->/g, "")
        .replace(/```maple-ref[^]*?```/g, "Source reference")
        .trim()
        .slice(0, 160) || kind
    );
  }
  formattedDay() {
    const [y, m, d] = this.notes.day().split("-").map(Number);
    return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  openPicker() {
    this.picker.set(true);
    void this.searchSources();
  }
  async searchSources() {
    const generation = ++this.pickerGeneration;
    this.pickerLoading.set(true);
    this.pickerError.set("");
    try {
      const page = await this.sources.list({
        ...emptySourceQuery(),
        text: this.sourceSearch.trim() || undefined,
      });
      if (generation === this.pickerGeneration) this.matches.set(page.items);
    } catch (e) {
      if (generation === this.pickerGeneration)
        this.pickerError.set(
          e instanceof Error ? e.message : "Sources are unavailable.",
        );
    } finally {
      if (generation === this.pickerGeneration) this.pickerLoading.set(false);
    }
  }
  insertSource(row: SourceRow) {
    const kind = sourceReferenceKind(row);
    if (
      this.editorInstance?.insertReference({
        v: 1,
        kind,
        eventID: row.id,
        label: row.subject,
      })
    ) {
      this.picker.set(false);
      this.notes.pendingSource.set(null);
    } else
      this.pickerError.set(
        "Switch to formatted view before inserting a source. Extended Markdown must remain in source mode.",
      );
  }
  private async insertPending(id: string) {
    if (this.destroyed) return;
    try {
      const detail = await this.sources.detail(id);
      if (!this.destroyed && this.notes.pendingSource() === id)
        this.insertSource(detail.row);
    } catch {
      if (this.destroyed) return;
      this.picker.set(true);
      this.pickerError.set(
        "The selected source is unavailable. Its ID remains queued for insertion.",
      );
    }
  }
}
