import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TaskActionsComponent, TaskActionRequest } from './task-actions.component';
import { WorldService } from './world.service';
import { taskRoot, dueInstant } from './task-ranking';
@Component({selector:'maple-desktop-task-actions',standalone:true,imports:[TaskActionsComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@if(record(); as task){<maple-task-actions [identity]="root()" [version]="version()" [disabled]="world.bridge.pending()" [waiting]="task.status==='waiting'" [terminal]="task.status==='completed'||task.status==='cancelled'" [undoID]="task.actionState?.lastMutationScope==='desktop' && task.actionState?.lastAction!=='undo' ? task.actionState?.lastMutationID || '' : ''" [deadline]="deadline()" (submitAction)="apply($event)" />
 @if(task.actionState?.resurfaceAt; as at){<p>Deferred until {{date(at)}}. The original deadline is unchanged.</p>}
 @if(task.actionState?.reviewAt; as at){<p>Waiting review: {{date(at)}}.</p>}}
`})
export class DesktopTaskActionsComponent {
 readonly world=inject(WorldService);readonly nodeID=input.required<string>();
 readonly root=computed(()=>taskRoot(this.nodeID(),this.world.data()));
 readonly suggestion=computed(()=>this.world.data().suggestions.find(s=>'source:'+s.id===this.root()));
 readonly record=computed(()=>this.root().startsWith('task:')?this.world.data().tasks.find(t=>'task:'+t.id===this.root()):this.suggestion()?.candidate);
 readonly version=computed(()=>this.suggestion()?.version??this.record()?.version??0);
 readonly deadline=computed(()=>this.record()?.due?dueInstant(this.record()!.due,true):undefined);
 date(at:number){return new Date(at*1000).toLocaleString();}
 async apply(request:TaskActionRequest){
  await this.world.bridge.act({action:'applyTaskAction',id:this.root(),expectedVersion:this.version(),requestID:request.requestID,
   change:{kind:request.intent,issuedAt:Date.parse(request.issuedAt)/1000,
    resurfaceAt:request.payload.resurfaceAt?Date.parse(request.payload.resurfaceAt)/1000:undefined,
    reviewAt:request.payload.reviewAt?Date.parse(request.payload.reviewAt)/1000:undefined,
    waitingOn:request.payload.waitingOn,targetMutationID:request.payload.targetMutationID}});
 }
}
