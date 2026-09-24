import { TaskActionsComponent, TaskActionRequest } from '../world/task-actions.component';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MuiButtonComponent } from '@maple/ui';
import { OverviewSurfaceComponent } from '../world/overview-surface.component';
import { NotebooksComponent } from '../notebooks/notebooks.component';
import { NotebookService } from '../notebooks/notebook.service';
import { companionHost } from '../core/companion-host';
export { companionHost, isCompanion } from '../core/companion-host';

export interface CompanionTask {id:string;title:string;status:string;activities:string[];activityIDs?:string[];actionState?:{resurfaceAt?:string;reviewAt?:string;waitingOn?:string;lastMutationID:string;lastAction:string;canUndo:boolean};due?:string;dueAt?:string;version?:number;detail?:string;assignee?:string}
export interface CompanionTaskAction {id:string;taskID:string;expectedVersion:number;status:string;intent?:string}
export interface CompanionCapture { id: string; text: string; createdAt: string }
export interface CompanionSnapshot { deviceID: string; captures: CompanionCapture[]; taskActions?:CompanionTaskAction[];taskActionReceipts?:{id:string;outcome:string;resultingVersion?:number}[]; receivedIDs?:string[]; uploadedIDs?:string[]; cloudEnabled?:boolean; paired?:boolean; connectionStatus?:string;
  mac?:{asOf:string;needsYouTotal?:number;waitingTotal?:number;laterTotal?:number;supportedTaskIntents?:string[];displayName?:string;activities?:{id:string;name:string;kind:string;lifecycle:string;openTaskCount:number}[];people?:{id:string;name:string;pinned:boolean;relationship:string}[];tasks:CompanionTask[];states:{property:string;status:string;value?:string}[]} }
@Component({
  selector: 'maple-companion', standalone: true, imports: [TaskActionsComponent, NgTemplateOutlet, FormsModule, MuiButtonComponent, NotebooksComponent, OverviewSurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="companion">
      <header><img src="maple-leaf.svg" alt="Just Maple leaf"/><span>Just Maple</span></header>
      <nav class="companion-nav" aria-label="Companion sections">
        @for (tab of tabs; track tab.id) {<mui-button variant="ghost" [fullWidth]="true" [attr.aria-current]="view() === tab.id ? 'page' : null" (pressed)="selectView(tab.id)">{{ tab.label }}</mui-button>}
      </nav>
      <p class="sync-status" role="status">{{ state().connectionStatus || 'Connecting to iCloud…' }}</p>
      @if (state().mac; as mac) {<p class="muted sync-time">Last synced {{ date(mac.asOf) }} · Available offline</p>
      @if(partialSnapshot()){<p class="muted">Showing a limited set from your Mac. More tasks are available there.</p>}}
      @if (error()) {<p class="error notice" role="alert">{{ error() }}</p>}
      @if (view() === 'notebooks') {<main class="notebooks-page"><maple-notebooks /></main>}
      @else if (view() === 'overview') {<main>
        @if (state().mac; as mac) {
          <maple-overview-surface [greeting]="greeting()" [name]="mac.displayName || ''" [states]="nowStates()" [activities]="activities()" [total]="mac.needsYouTotal ?? needsYouTasks().length" [waiting]="mac.waitingTotal ?? waitingTasks().length" (viewWaiting)="showWaiting()" (viewActivities)="selectView('activities')" [inspectable]="false" (viewTasks)="showNeedsYou()" (activitySelected)="showActivity($event)">
            <div attention>@for(task of attention(); track task.id) {<ng-container *ngTemplateOutlet="taskRow; context: {$implicit:task}" />}
            @empty {<p class="muted">No tasks need you in your latest Mac update.</p>}</div>
          </maple-overview-surface>
        } @else {<h1>Your overview.</h1><p>{{ loaded() ? 'Waiting for your Mac’s first update. Your overview will appear automatically.' : 'Opening your workspace…' }}</p>}
      </main>}
      @else if (view() === 'tasks') {<main><h1>{{ activityLabel() || (waitingOnly() ? 'Waiting' : laterOnly() ? 'Later' : needsOnly() ? 'Needs you' : 'Tasks') }}</h1>
        @if(activityFilter() || waitingOnly() || needsOnly() || laterOnly()) {<mui-button variant="ghost" (pressed)="showTasks()">All tasks</mui-button>}
        <div class="task-actions"><mui-button variant="ghost" (pressed)="showNeedsYou()">Needs you</mui-button><mui-button variant="ghost" (pressed)="showWaiting()">Waiting</mui-button><mui-button variant="ghost" (pressed)="showLater()">Later</mui-button></div>
        @for(task of visibleTasks(); track task.id) {<ng-container *ngTemplateOutlet="taskRow; context: {$implicit:task}" />}
        @empty {<p class="muted">No open tasks in this Mac update.</p>}
        <p class="muted">Changes sync to your Mac automatically. When offline, they stay queued on this iPhone.</p>
      </main>}
      @else if (view() === 'activities') {<main><h1>Activities.</h1>
        @for(activity of activities(); track activity.id) {<article class="saved-note"><mui-button variant="ghost" [fullWidth]="true" (pressed)="showActivity(activity.id)">{{ activity.name }}</mui-button><p>{{ activity.detail }} · {{ activity.openTaskCount }} open tasks</p></article>}
        @empty {<p class="muted">No active activities in your latest Mac update.</p>}
      </main>}
      @else if (view() === 'people') {<main><h1>Important people.</h1>
        @for(person of state().mac?.people || []; track person.id) {<article class="saved-note"><h2>{{ person.name }}</h2><small>{{ person.pinned ? 'Pinned · ' : '' }}{{ person.relationship }}</small></article>}
        @empty {<p class="muted">Important people appear as your Mac learns from your interactions.</p>}
      </main>}
      @else {<main><h1>Quick capture.</h1>
        <section class="capture-panel" aria-labelledby="capture-heading">
          <h2 id="capture-heading">Quick capture</h2>
          <label for="capture">What would you like to remember?</label>
          <textarea id="capture" [(ngModel)]="draft" (ngModelChange)="requestID = ''" placeholder="A thought, a note, something to come back to…" rows="5" maxlength="16000"></textarea>
          <mui-button [disabled]="busy() || !loaded() || !draft.trim()" (pressed)="save()">{{ busy() ? 'Saving…' : 'Save on iPhone' }}</mui-button>
          <p class="muted">{{ 'Saved on this iPhone first. iCloud sends it to your Mac automatically.' }}</p>
          @if (saved()) {<p role="status">Saved on this iPhone.</p>}
        </section>
        <section aria-labelledby="saved-heading"><div class="section-title"><h2 id="saved-heading">Saved on this iPhone</h2><span>{{ state().captures.length }}</span></div>
          @if (!loaded()) {<p role="status">Opening your captures…</p>}
          @else if (!state().captures.length) {<p class="muted">Your first thought starts here.</p>}
          @for (capture of state().captures; track capture.id) {
            <article class="saved-note"><p>{{ capture.text }}</p><small>{{ date(capture.createdAt) }} · {{ delivered(capture.id) ? 'Saved on Mac' : uploaded(capture.id) ? 'Saved in iCloud · waiting for Mac' : 'Waiting to upload automatically' }}</small></article>
          }
        </section>
      </main>}
      @for(change of undoableChanges(); track change.id){<section class="notice"><p>Task change saved on Mac.</p><mui-button variant="ghost" [disabled]="busy() || taskPending(change.taskID)" (pressed)="undoChange(change)">Undo {{intentLabel(change.intent)}}</mui-button></section>}
      <ng-template #taskRow let-task><article class="saved-note task-card" [attr.data-task-id]="task.id"><mui-button variant="ghost" [fullWidth]="true" (pressed)="openTask(task)">{{ task.title }}</mui-button><small>{{ task.status === 'waiting' ? 'Waiting' : deferred(task) ? 'Later' : 'Open' }}{{ task.due ? ' · ' + task.due : '' }}</small><div class="tags">@for(tag of task.activities; track $index; let i=$index) {<mui-button variant="ghost" (pressed)="task.activityIDs?.[i] ? showActivity(task.activityIDs[i]) : filterTasks(tag)">{{ tag }}</mui-button>}</div><div class="task-actions"><mui-button variant="ghost" [disabled]="busy() || !task.version || taskPending(task.id) || taskApplied(task)" (pressed)="completeTask(task)">Mark complete</mui-button><small role="status">{{ taskActionStatus(task.id) }}</small></div></article></ng-template>
      @if (selectedTask(); as task) {<section class="task-detail" role="dialog" aria-modal="false" [attr.aria-label]="task.title">
        <mui-button variant="ghost" (pressed)="selectedTaskID.set('')">Close task</mui-button><h2>{{ task.title }}</h2>
        <p>{{ task.detail || 'No additional details in this Mac update.' }}</p>
        @if (task.assignee) {<p>{{ task.status === 'waiting' ? 'Waiting on' : 'Assigned to' }} {{ task.assignee }}</p>}
        @if (task.due) {<p>Due {{ task.due }}</p>}
        <div class="tags">@for(tag of task.activities; track tag){<span>{{ tag }}</span>}</div>
        @if(typedActionsAvailable()) {<maple-task-actions [identity]="task.id" [deadline]="taskDeadline(task)" [version]="task.version || 0" [disabled]="busy() || !task.version || taskPending(task.id) || taskApplied(task)" [waiting]="task.status==='waiting'" [terminal]="task.status==='completed'||task.status==='cancelled'" [undoID]="task.actionState?.canUndo ? task.actionState?.lastMutationID || '' : ''" (submitAction)="applyTask(task,$event)" />}
        @else {<mui-button [disabled]="busy() || !task.version || taskPending(task.id) || taskApplied(task)" (pressed)="completeTask(task)">Mark complete</mui-button>}
        @if(task.actionState?.resurfaceAt; as at){<p>Deferred until {{date(at)}}.</p>}
        @if(task.actionState?.reviewAt; as at){<p>Waiting review: {{date(at)}}.</p>}
        <p role="status">{{ taskActionStatus(task.id) }}</p>
        @if (!task.version) {<p>Waiting for an updated Mac snapshot before editing.</p>}
      </section>}
    </div>`,
  styles: [`
    .task-detail{position:fixed;z-index:20;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));max-height:75dvh;overflow:auto;max-width:640px;margin:auto;padding:20px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:16px;box-shadow:0 10px 40px #0003}.task-detail p{white-space:pre-wrap;overflow-wrap:anywhere}.task-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.companion-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:-16px 0 28px;padding:5px;border:1px solid var(--color-border);border-radius:12px}.companion-nav button{flex:1;border:0;border-radius:8px;padding:12px;background:transparent;color:var(--color-text-muted);font:inherit;font-size:14px;min-height:44px}.companion-nav button[aria-current="page"]{background:var(--color-bg-secondary);color:var(--color-text-main);font-weight:600}.companion-nav button:focus-visible{outline:2px solid var(--color-primary)}.notebooks-page{min-width:0}
    .tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:20px;padding:3px 9px;font-size:12px}
    :host{display:block;min-height:100dvh;color:var(--color-text-main);background:var(--color-bg)}
    .companion{max-width:1000px;margin:auto;padding:24px 18px calc(30px + env(safe-area-inset-bottom));font-family:inherit}
    .sync-status{font-size:12px;color:var(--color-text-muted);margin:0}.sync-time{margin:4px 0 24px}.task-card h2{font-size:16px;line-height:1.45;margin-bottom:8px}.companion-nav mui-button[aria-current="page"]{background:var(--color-bg-secondary);border-radius:8px}header{display:flex;gap:12px;align-items:center;font-size:20px;font-weight:600;margin-bottom:38px}header img{width:34px;height:38px}header small{display:block;font-size:9px;letter-spacing:.12em;margin-top:5px;font-weight:500;opacity:.65}
    main{padding:0}.eyebrow{font-size:11px;letter-spacing:.16em;opacity:.6}h1{font-size:36px;line-height:1.15;font-weight:500;letter-spacing:-.04em;margin:14px 0}.intro{opacity:.7;line-height:1.5;margin-bottom:30px}h2{font-size:17px;font-weight:600;margin:0 0 16px}section{margin:26px 0}.capture-panel,.connection-panel{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:18px;padding:20px;background:color-mix(in srgb,currentColor 2%,transparent)}
    label{display:block;font-size:13px;margin-bottom:12px}textarea{display:block;width:100%;box-sizing:border-box;resize:vertical;background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:10px;padding:12px;font:inherit;font-size:16px;line-height:1.5;margin-bottom:15px}textarea:focus{outline:2px solid currentColor;outline-offset:2px}.muted,small{font-size:13px;opacity:.65;line-height:1.6}.muted{margin-bottom:0}.connection-panel h2{display:inline-block;margin-bottom:4px}.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.35;margin-right:9px}.section-title{display:flex;justify-content:space-between;align-items:baseline}.section-title span{opacity:.5}.saved-note{padding:18px 0;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent)}.saved-note p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:0 0 9px}footer{text-align:center;opacity:.5;font-size:11px;margin-top:38px;line-height:1.5}
  `]
})
export class CompanionComponent implements OnDestroy {
  private timer = setInterval(()=>{if(!this.busy())void this.load();},3000);
  ngOnDestroy(){clearInterval(this.timer);}
  readonly notes=inject(NotebookService);
  readonly tabs=[{id:'overview',label:'Overview'},{id:'tasks',label:'Tasks'},{id:'people',label:'People'},{id:'notebooks',label:'Notebooks'},{id:'capture',label:'Capture'}] as const;
  readonly view=signal<'overview'|'tasks'|'activities'|'people'|'notebooks'|'capture'>('overview');
  readonly activityFilter=signal('');
  readonly activityFilterID=signal('');readonly laterOnly=signal(false);
  readonly activityLabel=computed(()=>this.state().mac?.activities?.find(a=>a.id===this.activityFilterID())?.name || this.activityFilter());
  readonly waitingOnly=signal(false);
  readonly needsOnly=signal(false);
  readonly openTasks=computed(()=>(this.state().mac?.tasks || []).filter(t=>['open','in_progress','waiting'].includes(t.status)));
  readonly waitingTasks=computed(()=>this.openTasks().filter(t=>t.status==='waiting'));
  readonly needsYouTasks=computed(()=>this.openTasks().filter(t=>t.status!=='waiting' && !this.deferred(t)));
  readonly attention=computed(()=>this.needsYouTasks().slice(0,5));
  readonly greeting=computed(()=>{const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';});
  readonly nowStates=computed(()=>(this.state().mac?.states || []).filter(s=>['known','conflicting'].includes(s.status) && ['presence','currentBehavior','availability','employment','role','projects','travel'].includes(s.property)));
  readonly activities=computed(()=>(this.state().mac?.activities || []).filter(a=>a.lifecycle==='active').map(a=>({...a,detail:a.kind==='area'?'Ongoing':'Active'})));
  deferred(task:CompanionTask){return !!task.actionState?.resurfaceAt && Date.parse(task.actionState.resurfaceAt)>Date.now();}
  readonly partialSnapshot=computed(()=>{const m=this.state().mac;return !!m && (m.needsYouTotal??0)+(m.waitingTotal??0)+(m.laterTotal??0)>m.tasks.length;});
  readonly visibleTasks=computed(()=>(this.state().mac?.tasks || []).filter(t=>(this.activityFilterID()?this.matchesActivity(t):!this.activityFilter()||t.activities.includes(this.activityFilter())) && (!this.waitingOnly() || t.status==='waiting') && (!this.needsOnly() || ['open','in_progress'].includes(t.status)&&!this.deferred(t)) && (!this.laterOnly() || this.deferred(t))));
  matchesActivity(task:CompanionTask){
    if(task.activityIDs)return task.activityIDs.includes(this.activityFilterID());
    const all=this.state().mac?.activities||[];const selected=all.find(a=>a.id===this.activityFilterID());if(!selected)return false;
    const label=selected.name.slice(0,80);
    return all.filter(a=>a.name.slice(0,80)===label).length===1 && task.activities.includes(label);
  }
  private clearTaskFilters(){this.needsOnly.set(false);this.waitingOnly.set(false);this.laterOnly.set(false);this.activityFilter.set('');this.activityFilterID.set('');}
  showNeedsYou(){this.clearTaskFilters();this.needsOnly.set(true);void this.selectView('tasks');}
  showWaiting(){this.clearTaskFilters();this.waitingOnly.set(true);void this.selectView('tasks');}
  showLater(){this.clearTaskFilters();this.laterOnly.set(true);void this.selectView('tasks');}
  showTasks(){this.clearTaskFilters();void this.selectView('tasks');}
  filterTasks(name:string){this.clearTaskFilters();this.activityFilter.set(name);void this.selectView('tasks');}
  showActivity(id:string){const a=this.state().mac?.activities?.find(a=>a.id===id);if(a){this.clearTaskFilters();this.activityFilterID.set(id);void this.selectView('tasks');}}
  async selectView(view:'overview'|'tasks'|'activities'|'people'|'notebooks'|'capture'){if(this.view()===view)return;if(this.view()==='notebooks' && !await this.notes.flush())return;this.view.set(view);}
  readonly state=signal<CompanionSnapshot>({deviceID:'',captures:[]});
  readonly busy=signal(false); readonly loaded=signal(false); readonly error=signal(''); readonly saved=signal(false);
  draft=''; requestID='';
  constructor(){void this.load();}
  async load(){try{this.state.set(await this.command({action:'snapshot'}));this.loaded.set(true);}catch{this.error.set('Your iPhone storage could not be opened. Reopen the app to try again.');}}
  private command(body:unknown){const host=companionHost();if(!host)throw new Error('Native host unavailable');return host.postMessage(body) as Promise<CompanionSnapshot>;}
  async save(){
    if(this.busy() || !this.loaded() || !this.draft.trim())return;
    this.busy.set(true);this.error.set('');this.saved.set(false);
    this.requestID ||= crypto.randomUUID();
    try{this.state.set(await this.command({action:'capture',text:this.draft,id:this.requestID}));this.draft='';this.requestID='';this.saved.set(true);}
    catch{this.error.set('Could not save. Your text is still here; please try again.');}
    finally{this.busy.set(false);}
  }
  readonly selectedTaskID=signal('');
  readonly selectedTask=computed(()=>this.state().mac?.tasks.find(t=>t.id===this.selectedTaskID()));
  private taskRequests=new Map<string,string>();
  private completionRequests=new Map<string,TaskActionRequest>();
  private undoRequests=new Map<string,TaskActionRequest>();
  openTask(task:CompanionTask){this.selectedTaskID.set(task.id);}
  private latestAction(taskID:string){return this.state().taskActions?.filter(a=>a.taskID===taskID).at(-1);}
  private receipt(taskID:string){const action=this.latestAction(taskID);return action && this.state().taskActionReceipts?.find(r=>r.id.toLowerCase()===action.id.toLowerCase());}
  taskPending(taskID:string){return !!this.latestAction(taskID) && !this.receipt(taskID);}
  taskApplied(task:CompanionTask){return this.receipt(task.id)?.outcome==='applied' && this.latestAction(task.id)?.expectedVersion===task.version;}
  taskActionStatus(taskID:string){const r=this.receipt(taskID);return r?.outcome==='applied'?'Change saved on Mac':r?.outcome==='unsupported'?'Your Mac needs an update to perform this action.':r?.outcome==='conflict'?'Task changed on Mac. Review its latest details before trying again.':this.taskPending(taskID)?'Saved on iPhone · waiting for Mac':'';}
  taskDeadline(task:CompanionTask){const value=task.dueAt?Date.parse(task.dueAt)/1000:NaN;return Number.isFinite(value)?value:undefined;}
  async completeTask(task:CompanionTask){
    if(this.typedActionsAvailable()){
      const key=task.id+':'+task.version;
      let request=this.completionRequests.get(key);
      if(!request){request={requestID:crypto.randomUUID(),intent:'done',issuedAt:new Date().toISOString(),payload:{}};this.completionRequests.set(key,request);}
      await this.applyTask(task,request);return;
    }
    if(this.busy() || !task.version || this.taskPending(task.id) || this.taskApplied(task))return;
    this.busy.set(true);this.error.set('');
    const key=task.id+':'+task.version;
    const id=this.taskRequests.get(key) || crypto.randomUUID();this.taskRequests.set(key,id);
    try {this.state.set(await this.command({action:'taskAction',id,taskID:task.id,expectedVersion:task.version,status:'completed'}));this.taskRequests.delete(key);}
    catch {this.error.set('Could not save the task change. Please try again.');}
    finally {this.busy.set(false);}
  }
  readonly typedActionsAvailable=computed(()=>['done','later','waiting','notNeeded','undo'].every(i=>this.state().mac?.supportedTaskIntents?.includes(i)));
  readonly undoableChanges=computed(()=> (this.state().taskActions||[]).filter(a=>a.intent && a.intent!=='undo' && this.latestAction(a.taskID)?.id===a.id && this.state().taskActionReceipts?.some(r=>r.id.toLowerCase()===a.id.toLowerCase()&&r.outcome==='applied'&&!!r.resultingVersion)).slice(-3));
  intentLabel(intent?:string){return ({done:'completion',later:'deferral',waiting:'waiting change',notNeeded:'dismissal'} as Record<string,string>)[intent||'']||'change';}
  async applyTask(task:CompanionTask,request:TaskActionRequest){
    if(this.busy()||!task.version||this.taskPending(task.id))return;
    this.busy.set(true);this.error.set('');
    try{this.state.set(await this.command({action:'taskAction',id:request.requestID,taskID:task.id,expectedVersion:task.version,intent:request.intent,issuedAt:request.issuedAt,payload:request.payload}));}
    catch{this.error.set('Could not confirm the task change. Please retry; the same change will not be applied twice.');}
    finally{this.busy.set(false);}
  }
  async undoChange(change:CompanionTaskAction){
    const receipt=this.state().taskActionReceipts?.find(r=>r.id.toLowerCase()===change.id.toLowerCase());if(!receipt?.resultingVersion)return;
    const key='undo:'+change.id;
    let request=this.undoRequests.get(key);if(!request){request={requestID:crypto.randomUUID(),intent:'undo',issuedAt:new Date().toISOString(),payload:{targetMutationID:change.id}};this.undoRequests.set(key,request);}
    await this.applyTask({id:change.taskID,title:'',status:'completed',activities:[],version:receipt.resultingVersion},request);
  }
  uploaded(id:string){return this.state().uploadedIDs?.includes(id.toLowerCase()) ?? false;}
  delivered(id:string){return this.state().receivedIDs?.includes(id.toLowerCase()) ?? false;}
  date(value:string){return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
}
