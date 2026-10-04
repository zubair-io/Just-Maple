import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MuiButtonComponent } from '@maple/ui';
import { QualityCaptureService } from './quality-capture.service';

@Component({
  selector: 'maple-quality-capture', standalone: true, imports: [DatePipe, MuiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details class="panel">
    <summary>Local quality capture</summary>
    <p>Save the current unfiltered Needs you, Waiting and Later lists with their source evidence for local review.</p>
    <p>This contains private local task and source evidence. It stays on this Mac, outside iCloud. Nothing is sent and no models are run.</p>
    <p class="muted">Captures tab membership and order, not the visible viewport or historical screens. Quality evaluation is not run.</p>
    <div class="actions">
      <mui-button [disabled]="!capture.ready()" (pressed)="capture.capture()">Capture current task lists</mui-button>
      @if(capture.retryAvailable()) {<mui-button variant="ghost" [disabled]="!capture.ready()" (pressed)="capture.retry()">Retry this capture</mui-button>}
    </div>
    @if(capture.busy()) {<p role="status">Freezing and saving a local capture…</p>}
    @if(capture.error()) {<p role="alert">{{capture.error()}}</p>}
    @if(capture.receipt();as receipt) {
      <section aria-label="Saved local quality capture">
        <p role="status">Saved privately on this Mac. Quality evaluation not run.</p>
        <p>Captured {{receipt.capturedAt | date:'medium'}} · World revision {{receipt.worldRevision}}</p>
        @if(capture.projection();as projection) {
          <p>{{projection.surfaces.needsYou.length}} Needs you · {{projection.surfaces.waiting.length}} Waiting · {{projection.surfaces.later.length}} Later · {{projection.topTenNeedsYou.length}} in the first-ten list</p>
        }
        <p class="capture-path">{{receipt.path}}</p>
      </section>
    }
  </details>`,
  styles: [`summary{cursor:pointer}.capture-path{font:12px/1.5 var(--font-mono,monospace);overflow-wrap:anywhere}.muted{color:var(--color-text-muted)}`],
})
export class QualityCaptureComponent { readonly capture = inject(QualityCaptureService); }
