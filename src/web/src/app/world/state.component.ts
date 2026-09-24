import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MuiButtonComponent, MuiInputComponent } from "@maple/ui";
import { WorldService } from "./world.service";
import { StateClaim } from "./world.models";
import { SourceEvent } from "../core/native-bridge.service";
@Component({
  selector: "maple-state",
  standalone: true,
  imports: [DatePipe, FormsModule, MuiButtonComponent, MuiInputComponent],
  templateUrl: "./state.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateComponent {
  readonly world = inject(WorldService);
  readonly route = inject(ActivatedRoute);
  readonly subject = this.route.snapshot.paramMap.get("subject");
  readonly property = this.route.snapshot.paramMap.get("property");
  readonly lens = this.route.snapshot.data["lens"] as string | undefined;
  readonly selected = computed(() =>
    this.world
      .data()
      .states.find(
        (s) => s.subject === this.subject && s.property === this.property,
      ),
  );
  readonly properties = computed(() =>
    this.world.data().properties.filter((p) => p.lens === this.lens),
  );
  readonly propertyInfo = computed(() =>
    this.world.data().properties.find((p) => p.key === this.property),
  );
  readonly sources = signal<SourceEvent[]>([]);
  editing = false;
  value = "";
  duration = "3600";
  start = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  revision = 0;
  claimID = crypto.randomUUID();
  projection(key: string) {
    return this.world.state(
      this.lens === "Home" ? "home:self" : "person:self",
      key,
    );
  }
  correct() {
    this.value = this.selected()?.value ?? "";
    this.duration = this.propertyInfo()?.durable ? "durable" : "3600";
    this.revision = this.world.data().revision;
    this.claimID = crypto.randomUUID();
    this.editing = true;
  }
  async save() {
    const now = Date.now() / 1000,
      validFrom = new Date(this.start).getTime() / 1000;
    const record: StateClaim = {
      id: this.claimID,
      subject: this.subject!,
      property: this.property!,
      value: this.value,
      origin: "user-confirmed",
      evidenceIDs:
        this.selected()?.candidates.flatMap((c) => c.evidenceIDs) ?? [],
      observedAt: now,
      ingestedAt: now,
      validFrom,
      validUntil:
        this.duration === "durable"
          ? undefined
          : validFrom + Number(this.duration),
      retracted: false,
      sourceAvailable: true,
      version: 0,
    };
    if (
      await this.world.bridge.act({
        action: "correctState",
        record,
        expectedVersion: this.revision,
        requestID: this.world.request({ record, revision: this.revision }),
      })
    )
      this.editing = false;
  }
  async evidence() {
    const ids = [
      ...new Set(
        this.selected()?.candidates.flatMap((c) => c.evidenceIDs) ?? [],
      ),
    ];
    try {
      this.sources.set(
        (
          await Promise.all(ids.map((id) => this.world.bridge.evidence(id)))
        ).filter((e): e is SourceEvent => e !== null),
      );
    } catch {}
  }
}
