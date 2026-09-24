import { Component, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import { RankedTask } from './task-ranking';
import { WorldService } from './world.service';
import { isOpen } from './world.models';
@Component({
  selector:'maple-ranked-task-rows', standalone:true, imports:[MuiButtonComponent], changeDetection:ChangeDetectionStrategy.OnPush,
  template:`@for (item of items(); track item.id) {
    <article class="task-row ranked-task" [attr.data-task-id]="item.suggestion ? null : item.task.id" [attr.data-suggestion-id]="item.suggestion?.id">
      <mui-button variant="ghost" [ariaLabel]="item.suggestion ? 'Review ' + item.task.title : (isOpen(item.task) ? 'Complete ' : 'Reopen ') + item.task.title" [disabled]="world.bridge.pending()" (pressed)="toggle(item)">{{ isOpen(item.task) ? '○' : '✓' }}</mui-button>
      <div class="task-row-body">
        <mui-button variant="ghost" [fullWidth]="true" (pressed)="open(item)">{{ item.task.title }}</mui-button>
        @if (details() && item.suggestion?.sourceSubject) {<small class="task-source">{{ item.suggestion!.sourceSubject }} · {{ item.suggestion!.sourceSender }}</small>}
        <div class="task-context">
          <div class="tag-row">@for(id of item.task.activityIDs; track id) {
            <button class="activity-tag" (click)="world.go('activities/'+id)">{{ world.activity(id)?.name || 'Unavailable activity' }}</button>
          }</div>
          <small>{{ item.reason }}@if (item.sourceCount > 1) { · {{ item.sourceCount }} sources}</small>
        </div>
        @if (details()) {<p>{{ item.task.description }}</p>}
      </div>
      <span class="task-due">{{ world.dueLabel(item.task.due || item.task.scheduled) }}</span>
    </article>
  } @empty {<p class="empty">No tasks here yet.</p>}`
})
export class RankedTaskRowsComponent {
  readonly items=input.required<RankedTask[]>(); readonly details=input(false);
  readonly world=inject(WorldService); readonly isOpen=isOpen;
  open(item:RankedTask) {this.world.go(item.suggestion?'suggestions/'+item.suggestion.id:'tasks/'+item.task.id);}
  toggle(item:RankedTask) {if(item.suggestion)this.open(item);else void this.world.status(item.task,isOpen(item.task)?'completed':'open');}
}
