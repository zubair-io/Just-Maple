import { ChangeDetectionStrategy, Component, computed, inject, input, signal, OnDestroy, OnInit, output, effect } from '@angular/core';
import { MuiButtonComponent, MuiCheckboxComponent, MuiInputComponent } from '@maple/ui';
import { WorldService } from './world.service';
import { RankedTask } from './task-ranking';

export interface GroupChild {nodeID:string;expectedVersion:number}
export interface GroupReview {id:string;context:{intentID:string;actorID:string;targetID:string};maximumSpan:number;children:GroupChild[]}
interface GroupProposal {id:string;provider:string;proposal:{intent:string;actorID:string;target:string;reason:string;children:{nodeID:string;version:number;quote:string}[]}}
interface GroupResult {mutationID:string;children:{nodeID:string;version:number;mutationID:string}[]}
@Component({selector:'maple-task-group-panel',standalone:true,imports:[MuiButtonComponent,MuiCheckboxComponent,MuiInputComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@for(saved of visibleReviews();track saved.id){<details class="panel task-row"><summary>{{saved.context.intentID}} · {{saved.children.length}} open tasks</summary><p>{{saved.context.actorID}} · {{saved.context.targetID}}</p><ul>@for(child of saved.children;track child.nodeID){<li>{{titleFor(child.nodeID)}}</li>}</ul><mui-button variant="ghost" (pressed)="openSavedReview(saved)">Review group actions</mui-button></details>}
 <mui-button variant="ghost" (pressed)="togglePanel()">Group related tasks</mui-button>
 @if(expanded()) {<section class="panel" aria-label="Review a group of tasks">
 <h2>Review related tasks</h2><p>Choose tasks from the same source conversation. Confirm their shared action, responsible person and target. This groups distinct tasks; it does not merge their evidence.</p>
 <p class="footnote">Suggested groups always require your review. No group is completed or dismissed automatically.</p>
 <div class="field"><label>Suggestion window, in days</label><mui-input ariaLabel="Automatic suggestion window in days" [value]="proposalDays" (valueChange)="editProposalDays($event)" [disabled]="busy()" placeholder="Choose a time window" /></div>
 <div class="actions"><mui-button [disabled]="busy()" (pressed)="configure()">Enable automatic suggestions</mui-button><mui-button variant="ghost" [disabled]="busy()||!configured()" (pressed)="configure(false)">Pause suggestions</mui-button><mui-button variant="ghost" [disabled]="busy()" (pressed)="loadReviews()">Refresh suggestions</mui-button></div>
 <p role="status">{{proposalStatus()}}</p><mui-button variant="ghost" [disabled]="busy()||!configured()" (pressed)="retrySuggestions()">Retry failed suggestions</mui-button>
 @if(!review()) {@for(suggestion of proposals();track suggestion.id){<article><h3>Suggested: {{suggestion.proposal.intent}}</h3><p>{{suggestion.proposal.reason}}</p><details><summary>Supporting source quotes</summary>@for(child of suggestion.proposal.children;track child.nodeID){<blockquote>{{child.quote}}</blockquote>}</details><mui-button variant="ghost" [disabled]="busy()" (pressed)="reviewProposal(suggestion)">Review suggestion</mui-button></article>}}
 @if(!review()) {
 @for(saved of savedReviews();track saved.id){<mui-button variant="ghost" [disabled]="busy()" (pressed)="openReview(saved)">{{saved.context.intentID}} · {{saved.children.length}} reviewed tasks</mui-button>}

 <div class="field">@for(item of eligible();track item.id){<mui-checkbox [label]="item.task.title" [checked]="selected().includes(item.id)" [disabled]="busy()" (checkedChange)="toggle(item.id,$event)" />}</div>
 <div class="field"><label>Shared action</label><mui-input ariaLabel="Shared action" [(value)]="intent" [disabled]="busy()" placeholder="For example, review the documents" /></div>
 <div class="field"><label>Responsible person</label><mui-input ariaLabel="Responsible person" [(value)]="actor" [disabled]="busy()" placeholder="Who needs to act?" /></div>
 <div class="field"><label>Shared target</label><mui-input ariaLabel="Shared target" [(value)]="target" [disabled]="busy()" placeholder="Which documents or request?" /></div>
 <div class="field"><label>Maximum source span, in days</label><mui-input ariaLabel="Grouping window in days" [(value)]="days" [disabled]="busy()" placeholder="Choose a time window" /></div>
 <mui-button variant="primary" [disabled]="busy()||selected().length<2" (pressed)="prepare()">Review selected tasks</mui-button>
 } @else {
 <h3>{{review()!.context.intentID}}</h3><p>{{review()!.children.length}} reviewed tasks · {{review()!.context.actorID}} · {{review()!.context.targetID}}</p>
 <ul>@for(title of reviewedTitles();track $index){<li>{{title}}</li>}</ul>
 <p>Only these reviewed tasks will change. Tasks arriving later stay open.</p>
 @if(!applied()) {<div class="actions"><mui-button [disabled]="busy()" (pressed)="apply('done')">Mark group done</mui-button><mui-button [disabled]="busy()" (pressed)="apply('notNeeded')">Group not needed</mui-button></div>}
 @if(applied()&&!undone()){<mui-button [disabled]="busy()" (pressed)="undo()">Undo group action</mui-button>}
 <mui-button variant="ghost" [disabled]="busy()" (pressed)="reset()">Review a new selection</mui-button>
 }
 @if(message()){<p role="status">{{message()}}</p>}@if(error()){<p role="alert">{{error()}}</p>}
 </section>}`})
export class TaskGroupPanelComponent implements OnDestroy, OnInit {
 readonly world=inject(WorldService);readonly items=input.required<RankedTask[]>();readonly collapse=input(true);readonly groupedIDs=output<string[]>();
 readonly visibleReviews=computed(()=>{if(!this.collapse())return [];const used=new Set<string>();return [...this.savedReviews()].reverse().filter(review=>{const valid=review.children.every(child=>{const item=this.items().find(i=>i.id===child.nodeID);return !!item&&!['completed','cancelled'].includes(item.task.status)&&(item.id.startsWith('source:')?item.suggestion?.version:item.task.version)===child.expectedVersion&&!used.has(child.nodeID);});if(valid)review.children.forEach(c=>used.add(c.nodeID));return valid;});});
 constructor(){effect(()=>this.groupedIDs.emit(this.visibleReviews().flatMap(r=>r.children.map(c=>c.nodeID))));}
 ngOnInit(){void this.loadReviewedGroups();}
 titleFor(id:string){return this.items().find(i=>i.id===id)?.task.title ?? 'Reviewed task';}
 openSavedReview(review:GroupReview){this.openReview(review);this.expanded.set(true);}
 private async loadReviewedGroups(){try{const reviews=await this.world.bridge.group<GroupReview[]>({action:'reviewedObligationGroups'});if(!this.destroyed)this.savedReviews.set(Array.isArray(reviews)?reviews:[]);}catch(e){if(!this.destroyed)this.error.set(e instanceof Error?e.message:String(e));}}

 readonly expanded=signal(false);readonly selected=signal<string[]>([]);readonly busy=signal(false);
 readonly savedReviews=signal<GroupReview[]>([]);readonly review=signal<GroupReview|null>(null);readonly reviewedTitles=signal<string[]>([]);
 readonly applied=signal<GroupResult|null>(null);readonly undone=signal(false);readonly error=signal('');readonly message=signal('');
 readonly eligible=computed(()=>this.items().filter(i=>!['completed','cancelled'].includes(i.task.status)));
 intent='';actor='';target='';days='';proposalDays='';readonly configured=signal(false);readonly proposalStatus=signal('Choose a window to enable automatic suggestions.');readonly proposals=signal<GroupProposal[]>([]);private proposalVersions:Map<string,number>|null=null;
 private proposalWindowDirty=false;private loadingReviews=false;private destroyed=false;
 private refreshTimer=setInterval(()=>{if(!this.busy()){if(this.expanded())void this.loadReviews();else void this.loadReviewedGroups();}},15000);
 ngOnDestroy(){this.destroyed=true;clearInterval(this.refreshTimer);}
 editProposalDays(value:string){this.proposalDays=value;this.proposalWindowDirty=true;}
 private immutable=new Map<string,Record<string,unknown>>();
 private request(key:string,payload:Record<string,unknown>){if(!this.immutable.has(key))this.immutable.set(key,{...payload,requestID:crypto.randomUUID()});return this.immutable.get(key)!;}
 async togglePanel(){this.expanded.set(!this.expanded());if(this.expanded())await this.loadReviews();}
 async loadReviews(){if(this.loadingReviews||this.destroyed)return;this.loadingReviews=true;try{this.savedReviews.set(await this.world.bridge.group<GroupReview[]>({action:'reviewedObligationGroups'}));const settings=await this.world.bridge.group<{configuration:{maximumSpan:number}|null;status:{failed:number;running:number;coveredVersions:number;completed:number};proposals:GroupProposal[]}>({action:'obligationGroupingSettings'});this.configured.set(!!settings.configuration);if(settings.configuration&&!this.proposalWindowDirty)this.proposalDays=String(settings.configuration.maximumSpan/86400);this.proposals.set(settings.proposals);this.proposalStatus.set(!settings.configuration?'Choose a window to enable automatic suggestions.':settings.status.failed?'Some suggestions need a provider retry. Existing tasks are unchanged.':settings.status.running?'Reviewing recent sources for possible groups…':`Suggestions run automatically on changed recent evidence, up to 20 tasks per pass. ${settings.status.completed} passes completed; ${settings.status.coveredVersions} task versions reviewed. Review is always required.`);}catch(e){if(!this.destroyed)this.error.set(e instanceof Error?e.message:String(e));}finally{this.loadingReviews=false;}}
 async retrySuggestions(){if(this.busy())return;this.busy.set(true);try{await this.world.bridge.group({action:'retryObligationGrouping',requestID:crypto.randomUUID()});await this.loadReviews();}catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false);}}
 async configure(enabled=true){if(this.busy())return;const seconds=Number(this.proposalDays)*86400;if(enabled&&(!Number.isFinite(seconds)||seconds<=0)){this.error.set('Choose a positive suggestion window.');return;}this.busy.set(true);this.error.set('');try{const payload={action:'configureObligationGrouping',...(enabled?{maximumSpan:seconds}:{})};const key=JSON.stringify(payload);await this.world.bridge.group(this.request(key,payload));this.immutable.delete(key);await this.loadReviews();}catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false);}}
 reviewProposal(item:GroupProposal){this.review.set(null);this.selected.set(item.proposal.children.map(c=>c.nodeID));this.proposalVersions=new Map(item.proposal.children.map(c=>[c.nodeID,c.version]));this.intent=item.proposal.intent;this.actor=item.proposal.actorID==='person:self'?'Me':'';this.target=item.proposal.target;this.days=this.proposalDays;this.message.set('Confirm the shared action, responsible person and target below. If any selected task is hidden, switch to All open and clear activity filters.');this.error.set('');}

 openReview(review:GroupReview){this.review.set(review);this.reviewedTitles.set(review.children.map(c=>this.items().find(i=>i.id===c.nodeID)?.task.title ?? 'Reviewed task outside the current filter'));this.applied.set(null);this.undone.set(false);this.error.set('');this.message.set('');}
 toggle(id:string,on:boolean){this.selected.update(ids=>on?[...new Set([...ids,id])]:ids.filter(value=>value!==id));}
 async prepare(){
  if(this.busy())return;
  const chosen=this.eligible().filter(i=>this.selected().includes(i.id));
  const seconds=Number(this.days)*86400;
  if(chosen.length<2||chosen.length!==this.selected().length||!this.intent.trim()||!this.actor.trim()||!this.target.trim()||!Number.isFinite(seconds)||seconds<=0){this.error.set('Select at least two current tasks, confirm the action, person and target, and choose a positive time window.');return;}
  const children=chosen.map(i=>({nodeID:i.id,expectedVersion:i.id.startsWith('source:')?i.suggestion!.version:i.task.version}));
  if(this.proposalVersions&&children.some(c=>this.proposalVersions!.get(c.nodeID)!==c.expectedVersion)){this.error.set('A suggested task changed. Refresh suggestions before reviewing it.');return;}
  const payload={action:'reviewObligationGroup',children,intent:this.intent.trim(),actor:this.actor.trim(),target:this.target.trim(),maximumSpan:seconds};
  this.busy.set(true);this.error.set('');
  try{const review=await this.world.bridge.group<GroupReview>(this.request(JSON.stringify(payload),payload));this.review.set(review);this.reviewedTitles.set(chosen.map(i=>i.task.title));}
  catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false);}
 }
 async apply(kind:'done'|'notNeeded'){
  const review=this.review();if(!review||this.busy()||this.applied())return;
  const payload=this.request(review.id+kind,{action:'applyObligationGroupAction',review,kind,issuedAt:Date.now()/1000});
  this.busy.set(true);this.error.set('');
  try{const result=await this.world.bridge.group<GroupResult>(payload);this.applied.set(result);this.message.set(`${result.children.length} reviewed tasks updated.`);await this.refresh();}
  catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false);}
 }
 async undo(){
  const result=this.applied();if(!result||this.busy()||this.undone())return;
  const payload=this.request(result.mutationID+'undo',{action:'undoObligationGroupAction',targetMutationID:result.mutationID,issuedAt:Date.now()/1000});
  this.busy.set(true);this.error.set('');
  try{await this.world.bridge.group(payload);this.undone.set(true);this.message.set('Group action undone.');await this.refresh();}
  catch(e){this.error.set(e instanceof Error?e.message:String(e));}finally{this.busy.set(false);}
 }
 private async refresh(){try{await this.world.bridge.command({action:'snapshot'});}catch{this.message.update(m=>m+' The task list will refresh when available.');}}
 reset(){this.proposalVersions=null;this.review.set(null);this.applied.set(null);this.undone.set(false);this.selected.set([]);this.error.set('');this.message.set('');this.immutable.clear();void this.loadReviews();}
}
