import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MuiInputComponent } from '@maple/ui';
import { TaskTimingField } from './task-timing-field';

@Component({
  selector: 'maple-task-timing', standalone: true,
  imports: [FormsModule, MuiInputComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<fieldset class="field"><legend>{{ label() }}</legend><div class="form-grid">
    <div class="field"><label [for]="prefix() + '-kind'">Timing</label>
      <select [id]="prefix() + '-kind'" [(ngModel)]="field().kind">
        <option value="none">No date</option><option value="date">Date only</option><option value="instant">Exact time</option>
      </select>
    </div>
    @if (field().kind === 'date') {
      <div class="field"><label [for]="prefix() + '-date'">Date</label><input [id]="prefix() + '-date'" type="date" [(ngModel)]="field().date" /></div>
    }
    @if (field().kind === 'instant') {
      <div class="field"><label [for]="prefix() + '-time'">Date and time · this Mac's local time</label><input [id]="prefix() + '-time'" type="datetime-local" [(ngModel)]="field().time" /></div>
    }
    @if (field().kind !== 'none') {
      <div class="field"><label>{{ field().kind === 'date' ? 'Interpretation time zone' : 'Display time zone' }}</label>
        <mui-input [ariaLabel]="label() + ' time zone'" [(value)]="field().zone" />
      </div>
    }
  </div></fieldset>`,
})
export class TaskTimingComponent {
  readonly field = input.required<TaskTimingField>();
  readonly prefix = input.required<string>();
  readonly label = input.required<string>();
}
