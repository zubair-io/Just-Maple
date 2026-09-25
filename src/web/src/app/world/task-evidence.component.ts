import { Component, ChangeDetectionStrategy, computed, inject, input, signal } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import { WorldService } from './world.service';
import { taskRoot } from './task-ranking';
import { SourceEvidence } from '../sources/source.models';
import { SourceInspectorComponent } from '../sources/source-inspector.component';
import { TaskStatus } from './world.models';
@Component({selector:'maple-task-evidence',standalone:true,imports:[MuiButtonComponent,SourceInspectorComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<section class="panel">
 <h2>Progress and supporting messages</h2>
 @if (root() !== nodeID()) {<p>This message belongs to a combined task.</p><mui-button (pressed)="openRoot()">Open combined task</mui-button>}
 @if (progress(); as progress) {<p><strong>{{ progress.status.replaceAll('_',' ') }}</strong> · {{ progress.reason }}</p><blockquote>{{ progress.quote }}</blockquote>}
 @if (dates().length>1) {<p>Different dates appear in these sources: {{ dates().join(" · ") }}. Review the original messages before choosing the deadline.</p>}
 @for (relation of relations(); track relation.duplicateID) {<p>{{ relation.reason }}</p>}
 <div class="actions">@for (id of sources(); track id; let i=$index) {<mui-button variant="ghost" (pressed)="inspect(id)">Open source {{ i+1 }}</mui-button>}</div>
 @if(loading()){<p role="status">Opening source…</p>}
 @if(sourceError()){<p role="alert">{{sourceError()}}</p>}
 @if (visibleSource(); as event) {<maple-source-inspector [source]="event" (closed)="closeSource()" />}
 @if(!sources().length){<p>No original source is linked to this task.</p>}
 <div class="actions">
 @if (relations().length) {<mui-button [disabled]="world.bridge.pending()" (pressed)="correct(undefined,true)">Keep these tasks separate</mui-button>}
 @if (record()?.status !== 'open') {<mui-button [disabled]="world.bridge.pending()" (pressed)="correct('open')">This task is still open</mui-button>}

 </div>
 <small>Your status corrections take priority over automatic updates.</small>
 </section>`})
export class TaskEvidenceComponent {
 readonly world=inject(WorldService);readonly nodeID=input.required<string>();
 readonly root=computed(()=>taskRoot(this.nodeID(),this.world.data()));
 readonly record=computed(()=>this.root().startsWith('task:')?this.world.data().tasks.find(t=>'task:'+t.id===this.root()):this.world.data().suggestions.find(s=>'source:'+s.id===this.root())?.candidate);
 readonly progress=computed(()=>this.world.data().taskProgress?.find(p=>p.nodeID===this.root()));
 readonly relations=computed(()=>this.world.data().taskRelations?.filter(r=>taskRoot(r.duplicateID,this.world.data())===this.root()) ?? []);
 readonly sources=computed(()=>[...new Set([...(this.record()?.evidenceIDs ?? []),...this.world.data().suggestions.filter(s=>'source:'+s.id===this.root()).map(s=>s.eventID),...this.relations().flatMap(r=>r.evidenceIDs),...(this.progress()?[this.progress()!.eventID]:[])])]);
 readonly dates=computed(()=>{
  const nodes=[this.root(),...this.relations().map(r=>r.duplicateID)];
  return [...new Set(nodes.map(id=>id.startsWith('task:')?this.world.data().tasks.find(t=>'task:'+t.id===id)?.due:this.world.data().suggestions.find(s=>'source:'+s.id===id)?.candidate.due).filter(d=>!!d).map(d=>this.world.dueLabel(d)))];
 });
 readonly source=signal<SourceEvidence|null>(null);readonly sourceError=signal('');readonly loading=signal(false);private request=0;
 readonly visibleSource=computed(()=>this.source() && this.sources().includes(this.source()!.id)?this.source():null);
 closeSource(){this.request++;this.source.set(null);this.sourceError.set('');this.loading.set(false);}
 async inspect(id:string){const request=++this.request;this.source.set(null);this.sourceError.set('');this.loading.set(true);try {const source=await this.world.bridge.inspectSource(id);if(request===this.request)this.source.set(source);}catch{if(request===this.request)this.sourceError.set('This source could not be opened. Try again; the source reference has been preserved.');}finally{if(request===this.request)this.loading.set(false);}}
 openRoot(){this.world.go(this.root().startsWith('task:')?'tasks/'+this.root().slice(5):'suggestions/'+this.root().slice(7));}
 async correct(status?:TaskStatus,separate=false){
  const version=this.root().startsWith('task:')?this.record()?.version:this.world.data().suggestions.find(s=>'source:'+s.id===this.root())?.version;
  if(version===undefined)return;
  const payload={action:'correctTaskInference' as const,id:this.root(),status,separate,expectedVersion:version};
  await this.world.bridge.act({...payload,requestID:this.world.request(payload)});
 }
}
