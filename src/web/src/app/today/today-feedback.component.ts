import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import type { MapleRun, DocumentSuggestions } from './today-document.service';
export interface TodayFeedback { key:string;title:string;detail:string;action:'cancel'|'retry'|'insert'|'configure'|'review'|'refresh';label:string; }
export function nextFeedback(run:MapleRun|null,pending:string,suggestions:DocumentSuggestions):TodayFeedback|null {
 if(run && ['failed','configuration_required','unapplied','queued','running'].includes(run.status)){
  const messages:Record<string,[string,string,TodayFeedback['action'],string]>={
   failed:['Maple needs another try','The request failed. Your writing and captured sources are preserved.','retry','Retry request'],
   configuration_required:['Connect Maple to a provider','This request needs provider configuration before it can run.','configure','Open AI settings'],
   unapplied:['A reply is waiting','Its original anchor changed. Review the retained response before inserting it.','insert','Review retained reply'],
   queued:['Maple is queued','Your request is waiting to run. You can keep writing.','cancel','Cancel request'],
   running:['Maple is working','Your request is in progress. You can keep writing.','cancel','Cancel request'],
  };
  const [title,detail,action,label]=messages[run.status];return{key:run.runID+':'+run.status,title,detail,action:action==='retry'&&!run.request?.text?'insert':action,label:action==='retry'&&!run.request?.text?'Review request':label};
 }
 if(pending)return{key:'pending:'+pending,title:'New context is waiting',detail:pending,action:'refresh',label:'Retry context update'};
 const count=suggestions.tasks.length+suggestions.carryForward.length;
 if(count)return{key:'suggestions:'+JSON.stringify([suggestions.tasks.map(t=>[t.taskID,t.version]),suggestions.carryForward.map(t=>[t.blockID,t.version])]),title:`${count} item${count===1?'':'s'} to consider`,detail:'Review linked tasks and unfinished writing before bringing them onto today’s canvas.',action:'review',label:'Review items'};
 return null;
}
@Component({selector:'maple-today-feedback',standalone:true,imports:[MuiButtonComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@if(feedback();as item){@if(!dismissed().includes(item.key)){
  <section class="today-feedback" aria-label="Maple attention" aria-live="polite">
   <div><strong>✦ {{item.title}}</strong><p>{{item.detail}}</p></div>
   <mui-button variant="ghost" [disabled]="busy()" (pressed)="item.action==='review' ? reviewOpen.set(!reviewOpen()) : action.emit(item.action)">{{item.label}}</mui-button>
   @if(item.action==='review'){<button type="button" aria-label="Dismiss these suggestions" (click)="dismissed.update(addDismissed(item.key));reviewOpen.set(false)">×</button>}
  </section>
  @if(reviewOpen()&&item.action==='review'){
   <section class="today-suggestion-review" aria-label="Suggested items">
    @for(task of suggestions().tasks.slice(0,5);track task.taskID){<div><span>{{task.title}}<small>Linked task · {{task.evidenceIDs.length}} source references</small></span><mui-button variant="ghost" [disabled]="busy()" (pressed)="taskRequested.emit(task.taskID)">Add linked task</mui-button></div>}
    @for(offer of suggestions().carryForward.slice(0,5);track offer.blockID){<div><span>{{offer.label}}<small>Unfinished writing · {{offer.day}}</small></span><mui-button variant="ghost" [disabled]="busy()" (pressed)="carryRequested.emit(offer)">Move to today</mui-button></div>}
    @if(suggestions().hasMore){<p>More items are available in your tasks and earlier days.</p>}
   </section>
  }
 }} `,
 styles:[`.today-feedback{display:flex;align-items:center;gap:12px;padding:12px 16px;margin:12px 0;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-main);font:13px/1.5 var(--font-sans)}.today-feedback div{flex:1}.today-feedback strong{font-weight:500;color:var(--color-agent,var(--color-primary))}.today-feedback p{margin:4px 0 0;color:var(--color-text-muted);font-size:12px}.today-feedback>button{border:0;background:none;color:var(--color-text-muted);cursor:pointer}.today-suggestion-review{padding:12px 16px;border:1px solid var(--color-border);border-radius:10px;font:13px/1.5 var(--font-sans)}.today-suggestion-review>div{display:flex;gap:16px;align-items:center;padding:8px 0}.today-suggestion-review span{flex:1}.today-suggestion-review small{display:block;color:var(--color-text-muted)}@media(max-width:600px){.today-feedback{flex-wrap:wrap}}`]})
export class TodayFeedbackComponent {
 readonly run=input<MapleRun|null>(null);
 readonly pending=input('');
 readonly suggestions=input<DocumentSuggestions>({tasks:[],carryForward:[],hasMore:false});
 readonly busy=input(false);
 readonly action=output<TodayFeedback['action']>();
 readonly taskRequested=output<string>();
 readonly carryRequested=output<DocumentSuggestions['carryForward'][number]>();
 readonly feedback=computed(()=>nextFeedback(this.run(),this.pending(),this.suggestions()));
 readonly reviewOpen=signal(false);
 readonly dismissed=signal<string[]>([]);
 addDismissed(key:string){return (keys:string[])=>[...keys.slice(-19),key];}
}
