import { isCompanion } from "../core/companion-host";
import {
  Component,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { ActivatedRoute } from "@angular/router";
import { MuiButtonComponent, MuiInputComponent } from "@maple/ui";
import { NotebookService } from "./notebook.service";
import { MarkdownEditorComponent } from "./markdown-editor.component";
import {
  TodayDocumentService,
  TodayDocument,
} from "../today/today-document.service";
import { MapleEditorComponent } from "../editor/maple-editor.component";
import { SourceDetailComponent } from "../sources/source-detail.component";
import {
  SourcesService,
  SourceRow,
  emptySourceQuery,
} from "../sources/sources.service";
@Component({
  selector: "maple-notebooks",
  standalone: true,
  providers: [TodayDocumentService],
  imports: [
    FormsModule,
    DatePipe,
    MuiButtonComponent,
    MuiInputComponent,
    MarkdownEditorComponent,
    MapleEditorComponent,
    SourceDetailComponent,
  ],
  templateUrl: "./notebooks.component.html",
  styleUrl: "./notebooks.component.css",
})
export class NotebooksComponent implements OnDestroy {
  readonly companion = isCompanion();
  readonly notes = inject(NotebookService);
  readonly managed = inject(TodayDocumentService);
  readonly sources = inject(SourcesService);
  readonly route = inject(ActivatedRoute, { optional: true });
  readonly managedMode = computed(
    () => !!this.notes.document()?.documentID && !this.companion,
  );
  readonly selected = signal<string | null>(null);
  readonly picker = signal(false);
  readonly matches = signal<SourceRow[]>([]);
  readonly pickerError = signal("");
  readonly pickerLoading = signal(false);
  sourceSearch = "";
  name = "";
  dialog: "" | "book" | "note" | "copy" = "";
  @ViewChild(MapleEditorComponent) editor?: MapleEditorComponent;
  private timer = setInterval(() => {
    void this.notes.refresh();
    if (this.managedMode()) void this.managed.pollRun();
  }, 5000);
  private generation = 0;
  private routeSubscription = this.route?.queryParamMap.subscribe((params) => {
    const documentID = params.get("document");
    if (documentID) void this.openManagedLink(documentID);
  });
  constructor() {
    this.notes.managedFlusher = () => this.managed.flush();
    void this.notes.refresh();
    effect(() => {
      this.notes.generation();
      const doc = untracked(() => this.notes.document());
      if (doc?.documentID && !this.companion)
        void this.managed.openDocument(doc.documentID).then((opened) => {
          if (opened && this.notes.document()?.documentID === doc.documentID)
            this.notes.dirty.set(false);
        });
    });
  }
  async flush() {
    return (await this.managed.flush()) && (await this.notes.flush());
  }
  async open(path: string) {
    if (await this.flush()) await this.notes.open(path);
  }
  async selectBook(id: string) {
    if (await this.flush()) await this.notes.selectBook(id);
  }
  async closeNote() {
    if (await this.flush()) await this.notes.closeNote();
  }
  async disconnect() {
    if (await this.flush()) await this.notes.disconnect();
  }
  async submit() {
    if (!this.name.trim() || !(await this.flush())) return;
    this.notes.error.set("");
    if (this.dialog === "book") await this.notes.createBook(this.name);
    else if (this.dialog === "copy") {
      if (this.managedMode()) await this.managed.recoveryCopy();
      else await this.notes.saveCopy(this.name);
    } else await this.notes.createNote(this.name);
    if (!this.notes.error()) {
      this.dialog = "";
      this.name = "";
    }
  }
  show(dialog: "book" | "note" | "copy") {
    if (dialog === "copy" && this.managedMode()) {
      void this.managed.recoveryCopy();
      return;
    }
    this.dialog = dialog;
    this.name = "";
  }
  async enableManaged() {
    if (this.companion || !(await this.flush())) return;
    const doc = this.notes.document();
    if (!doc) return;
    try {
      const registered = await this.notes.bridge.notebook<TodayDocument>(
        "documentRegister",
        {
          notebookID: doc.notebookID,
          path: doc.path,
          expectedRevision: doc.revision,
        },
      );
      this.notes.load({
        ...doc,
        content: registered.content,
        revision: registered.revision,
        documentID: registered.documentID,
        readOnly: registered.readOnly,
      });
    } catch (e) {
      this.notes.fail(e);
    }
  }
  async openManagedLink(documentID: string) {
    if (this.companion || !(await this.flush())) return;
    try {
      const doc = await this.notes.bridge.notebook<TodayDocument>(
        "documentOpen",
        { documentID },
      );
      await this.notes.refresh();
      await this.notes.selectBook(doc.notebookID);
      this.notes.load({ ...doc });
    } catch (e) {
      this.notes.fail(e);
    }
  }
  openPicker() {
    this.picker.set(true);
    void this.searchSources();
  }
  async searchSources() {
    const generation = ++this.generation;
    this.pickerLoading.set(true);
    this.pickerError.set("");
    try {
      const result = await this.sources.list({
        ...emptySourceQuery(),
        text: this.sourceSearch.trim() || undefined,
      });
      if (generation === this.generation) this.matches.set(result.items);
    } catch (e) {
      if (generation === this.generation)
        this.pickerError.set(
          e instanceof Error ? e.message : "Source search unavailable.",
        );
    } finally {
      if (generation === this.generation) this.pickerLoading.set(false);
    }
  }
  insertSource(row: SourceRow) {
    const kind = row.type.includes("email")
      ? "email"
      : row.type.includes("message")
        ? "message"
        : row.type.includes("record")
          ? "recording"
          : "source";
    if (
      this.editor?.insertReference({
        v: 1,
        kind,
        eventID: row.id,
        label: row.subject,
      })
    )
      this.picker.set(false);
    else
      this.pickerError.set(
        "Switch to formatted view before inserting a source.",
      );
  }
  ngOnDestroy() {
    this.notes.managedFlusher = undefined;
    clearInterval(this.timer);
    this.routeSubscription?.unsubscribe();
    this.generation++;
  }
}
