import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { A11yModule } from "@angular/cdk/a11y";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { MuiButtonComponent, MuiInputComponent } from "@maple/ui";
import {
  NativeBridge,
  Fact,
  Person,
  SourceEvent,
  Work,
  SimpleAction,
} from "../core/native-bridge.service";
import { ConnectionsComponent } from "./connections.component";
@Component({
  selector: "maple-workspace",
  standalone: true,
  imports: [
    A11yModule,
    DatePipe,
    JsonPipe,
    FormsModule,
    MuiButtonComponent,
    MuiInputComponent,
    ConnectionsComponent,
  ],
  templateUrl: "./workspace.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent {
  readonly router = inject(Router);
  go(path: string) {
    void this.router.navigateByUrl(path);
  }
  subjectName(subject: string) {
    return subject === "person:self"
      ? "You"
      : (this.s().claims.find(
          (c) => c.subject === subject && c.predicate === "person.name",
        )?.value ?? "Contact");
  }
  auditQuery="newer_than:30d -in:spam -in:trash -in:drafts";
  async runAudit(local=false){try{await this.bridge.notebook(local?"connectorAuditLocal":"connectorAudit",{query:this.auditQuery});}catch{}}
  readonly bridge = inject(NativeBridge);
  readonly s = this.bridge.state;
  readonly page = inject(ActivatedRoute).snapshot.data["page"] as string;
  readonly attention = computed(() =>
    this.s().work.filter(
      (w) => ["notify", "ask_user"].includes(w.kind) && w.status === "unread",
    ),
  );
  readonly calendar = computed(() =>
    [...this.s().appleCalendar, ...this.s().googleCalendar].sort(
      (a, b) => a.start - b.start,
    ),
  );
  readonly ownFacts = computed(() =>
    this.s().facts.filter((f) => f.subject === "person:self"),
  );
  readonly ownClaims = computed(() =>
    this.s().claims.filter((c) => c.subject === "person:self"),
  );
  readonly peopleResults = signal<Person[] | null>(null);
  readonly results = signal<SourceEvent[]>([]);
  readonly detail = signal<unknown>(null);
  readonly selectedFact = signal<Fact | null>(null);
  readonly selectedWork = signal<Work | null>(null);
  query = "";
  note = "";
  personName = "";
  relationship = "";
  answer = "";
  correction = "";
  act(action: SimpleAction) {
    void this.bridge.act({ action });
  }
  decision(eventID: string) {
    return this.s().decisions.find((d) => d.eventID === eventID);
  }
  async search() {
    try {
      this.results.set(await this.bridge.search(this.query));
    } catch {}
  }
  async findPerson() {
    try {
      this.peopleResults.set(await this.bridge.people(this.query));
    } catch {}
  }
  async saveNote() {
    if (
      this.note.trim() &&
      (await this.bridge.act({ action: "capture", text: this.note }))
    )
      this.note = "";
  }
  async savePerson() {
    if (
      this.personName.trim() &&
      (await this.bridge.act({
        action: "person",
        name: this.personName,
        relationship: this.relationship,
      }))
    ) {
      this.personName = "";
      this.relationship = "";
    }
  }
  async pin(p: Person) {
    if (
      await this.bridge.act({
        action: "pinPerson",
        id: p.id,
        pinned: !p.pinned,
      })
    ) {
      if (this.peopleResults()) await this.findPerson();
    }
  }
  personState(p: Person) {
    this.detail.set({
      person: p,
      claims: this.s().claims.filter((c) => c.subject === p.id),
      facts: this.s().facts.filter((f) => f.subject === p.id),
    });
  }
  async source(id: string) {
    try {
      this.detail.set(await this.bridge.evidence(id));
    } catch {}
  }
  review(w: Work) {
    this.answer = "";
    this.selectedWork.set(w);
    this.detail.set(this.decision(w.eventID));
  }
  close() {
    this.detail.set(null);
    this.selectedFact.set(null);
    this.selectedWork.set(null);
  }
  edit(f: Fact) {
    this.correction = f.value;
    this.selectedFact.set(f);
    this.detail.set(f);
  }
  async correct() {
    const f = this.selectedFact();
    if (
      f &&
      (await this.bridge.act({
        action: "correct",
        id: f.id,
        value: this.correction,
      }))
    )
      this.close();
  }
  async respond() {
    const w = this.selectedWork();
    if (
      w &&
      this.answer.trim() &&
      (await this.bridge.act({ action: "answer", id: w.id, text: this.answer }))
    )
      this.close();
  }
}
