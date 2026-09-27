import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
export interface GroupReview {id:string;context:{intentID:string;actorID:string;targetID:string;connector:string;account:string;sourceScopeID:string};maximumSpan:number;children:{nodeID:string;expectedVersion:number}[]}
export interface ReviewedGroup {review:GroupReview;titles:Record<string,string>}
export interface GroupAction {id:string;intent:'done'|'notNeeded'|'undo';issuedAt:string;review?:GroupReview;targetMutationID?:string}
export interface GroupReceipt {id:string;outcome:string;children?:{nodeID:string;version:number;mutationID:string}[]}
@Component({selector:'maple-companion-groups',standalone:true,imports:[MuiButtonComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`@if(groups().length){<section aria-label="Reviewed groups"><h2>Reviewed groups</h2><p>These exact requests were grouped on your Mac. New arrivals stay separate.</p>
 @for(group of groups();track group.review.id){<details><summary>{{group.review.context.intentID}} · {{group.review.children.length}} requests</summary><p>{{group.review.context.actorID}} · {{group.review.context.targetID}}</p>
 <ul>@for(child of group.review.children;track child.nodeID){<li>{{group.titles[child.nodeID] || 'Unavailable task title'}}</li>}</ul>
 @if(available()){<div class="actions"><mui-button [disabled]="busy() || pending(group.review.id)" (pressed)="send(group,'done')">Done all {{group.review.children.length}}</mui-button><mui-button variant="ghost" [disabled]="busy() || pending(group.review.id)" (pressed)="send(group,'notNeeded')">Not needed · all {{group.review.children.length}}</mui-button></div>}
 @else{<p>Open the updated Mac app to enable group actions.</p>}
 @if(status(group.review.id)){<p role="status">{{status(group.review.id)}}</p>}
 </details>}</section>}
 @for(action of undoable();track action.id){<section class="notice"><p>{{action.review?.context?.intentID || 'Group'}} · group change saved on Mac.</p><mui-button variant="ghost" [disabled]="busy()" (pressed)="undo(action)">Undo group change</mui-button></section>}
 @for(action of pendingUndos();track action.id){<p role="status">Group undo saved on iPhone · waiting for Mac.</p>}
 @for(action of failedUndos();track action.id){<p role="alert">The group changed after your action. Review its children on your Mac; nothing was partially undone.</p>}
 @if(total()>groups().length){<p>Additional reviewed groups are available on your Mac.</p>}`,
 styles:[`:host{display:block;margin:20px 0}details{padding:16px;border:1px solid var(--color-border);border-radius:12px;margin:12px 0;background:var(--color-bg-secondary)}summary{cursor:pointer;font-weight:600}li{margin:8px 0;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap}.notice{padding:12px}`]})
export class CompanionGroupsComponent {
 readonly groups=input<ReviewedGroup[]>([]);readonly actions=input<GroupAction[]>([]);readonly receipts=input<GroupReceipt[]>([]);readonly busy=input(false);readonly available=input(false);readonly total=input(0);
 readonly requested=output<GroupAction>();private requests=new Map<string,GroupAction>();
 private receipt(id:string){return this.receipts().find(r=>r.id.toLowerCase()===id.toLowerCase());}
 private latest(groupID:string){return this.actions().filter(a=>a.review?.id===groupID).at(-1);}
 pending(groupID:string){const action=this.latest(groupID);return !!action&&!this.receipt(action.id);}
 status(groupID:string){const action=this.latest(groupID);if(!action)return '';const outcome=this.receipt(action.id)?.outcome;return outcome==='applied'?'Group change saved on Mac':outcome==='conflict'?'A child changed. Review this group again on your Mac.':outcome==='unsupported'?'Update your Mac to use group actions.':'Saved on iPhone · waiting for Mac';}
 send(group:ReviewedGroup,intent:'done'|'notNeeded'){
  if(this.busy()||!this.available()||this.pending(group.review.id))return;
  const key=JSON.stringify([group.review,intent]);let request=this.requests.get(key);
  if(!request || this.receipt(request.id)){request={id:crypto.randomUUID(),intent,issuedAt:new Date().toISOString(),review:structuredClone(group.review)};this.requests.set(key,request);}
  this.requested.emit(request);
 }
 undoable(){return this.actions().filter(a=>a.intent!=='undo'&&this.receipt(a.id)?.outcome==='applied'&&!this.actions().some(u=>u.intent==='undo'&&u.targetMutationID?.toLowerCase()===a.id.toLowerCase())).slice(-3);}
 pendingUndos(){return this.actions().filter(a=>a.intent==='undo'&&!this.receipt(a.id));}
 failedUndos(){return this.actions().filter(a=>a.intent==='undo'&&this.receipt(a.id)?.outcome==='conflict').slice(-1);}
 undo(action:GroupAction){if(this.busy()||!this.available())return;const key='undo:'+action.id;let request=this.requests.get(key);if(!request){request={id:crypto.randomUUID(),intent:'undo',issuedAt:new Date().toISOString(),targetMutationID:action.id};this.requests.set(key,request);}this.requested.emit(request);}
}
