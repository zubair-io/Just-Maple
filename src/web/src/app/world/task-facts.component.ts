import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { LifeTask } from './world.models';
import { WorldService } from './world.service';
@Component({selector:'maple-task-facts',standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,
  template:`<dl class="detail-list">
    @if(reason()){<dt>Attention</dt><dd>{{ reason() }}</dd>}
    <dt>Status</dt><dd>{{ task().status.replaceAll('_', ' ') }}</dd>
    <dt>Due</dt><dd>{{ world.dueLabel(task().due) }}@if(task().due){ · {{ task().due!.timeZone }}}</dd>
    <dt>Scheduled</dt><dd>{{ world.dueLabel(task().scheduled) }}@if(task().scheduled){ · {{ task().scheduled!.timeZone }}}</dd>
    <dt>Responsible person</dt><dd>{{ task().assignee || 'Not assigned' }} · private label</dd>
    @if(task().status === 'waiting') {<dt>Waiting on</dt><dd>{{ task().actionState?.waitingOn || task().waitingReason || 'Not specified' }}</dd>}
    <dt>Where</dt><dd>{{ task().place || 'Not set' }}</dd>
    <dt>People</dt><dd>{{ task().people.join(', ') || 'None linked' }}</dd>
    @if(task().seriesID){<dt>Occurrence</dt><dd>{{ task().occurrenceKey }}</dd>}
  </dl>`})
export class TaskFactsComponent {
  readonly task = input.required<LifeTask>();
  readonly world = inject(WorldService);
  readonly nodeID = input('');
  readonly reason = computed(() => this.world.rankedTasks().find(item => item.id === this.nodeID())?.reason);
}
