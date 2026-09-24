import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { MuiButtonComponent } from "@maple/ui";
import { WorldService } from "./world.service";
import { History } from "./world.models";
@Component({
  selector: "maple-history",
  standalone: true,
  imports: [DatePipe, JsonPipe, MuiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="eyebrow">What changed</div>
    <h1>History</h1>
    <p>
      Events and decisions over time. History is separate from what is currently
      true.
    </p>
    @for (h of entries(); track h.id) {
      <article class="item">
        <div class="row">
          <h3>{{ h.type.replaceAll(".", " ").replaceAll("_", " ") }}</h3>
          <small>{{ h.recordedAt * 1000 | date: "medium" }}</small>
        </div>
        <p>{{ h.actor }}</p>
        <details>
          <summary>Inspect recorded change</summary>
          <p>Effective {{ h.effectiveAt * 1000 | date: "medium" }}</p>
          <pre>{{ display(h.before) | json }}</pre>
          <pre>{{ display(h.after) | json }}</pre>
        </details>
      </article>
    } @empty {
      <p>No task, activity or state changes yet.</p>
    }
    <div class="actions">
      <mui-button [disabled]="loading()" (pressed)="more()"
        >Load older changes</mui-button
      ><mui-button variant="ghost" (pressed)="world.go('processing')"
        >Source decisions & processing</mui-button
      >
    </div>`,
})
export class HistoryComponent {
  readonly world = inject(WorldService);
  readonly older = signal<History[]>([]);
  readonly loading = signal(false);
  entries() {
    return [
      ...new Map(
        [...this.world.data().history, ...this.older()].map((h) => [h.id, h]),
      ).values(),
    ].sort((a, b) => b.sequence - a.sequence);
  }
  display(value?: string) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return value;
    }
  }
  async more() {
    this.loading.set(true);
    try {
      this.older.update((v) => v);
      const rows = await this.world.bridge.history(
        this.entries().at(-1)?.sequence,
      );
      this.older.update((v) => [...v, ...rows]);
    } catch {
      // The bridge displays a recoverable error and keeps the current page.
    } finally {
      this.loading.set(false);
    }
  }
}
