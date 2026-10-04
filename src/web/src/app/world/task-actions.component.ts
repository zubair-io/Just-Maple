import { ChangeDetectionStrategy, Component, HostListener, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MuiButtonComponent, MuiInputComponent } from '@maple/ui';
export type TaskIntent = 'done'|'later'|'waiting'|'notNeeded'|'undo';
export interface TaskActionRequest {identity:string;expectedVersion:number;requestID:string;intent:TaskIntent;issuedAt:string;payload:{resurfaceAt?:string;reviewAt?:string;waitingOn?:string;targetMutationID?:string}}
@Component({selector:'maple-task-actions',standalone:true,imports:[FormsModule,MuiButtonComponent,MuiInputComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<div class="actions">
 @if (!terminal()) {<mui-button variant="primary" [disabled]="disabled()" (pressed)="send('done')">Done</mui-button>@if(!waiting()){<mui-button [disabled]="disabled()" (pressed)="open('later')">Later</mui-button>}<mui-button [disabled]="disabled()" (pressed)="open('waiting')">Waiting</mui-button><mui-button variant="ghost" [disabled]="disabled()" (pressed)="send('notNeeded')">Not needed</mui-button>}
 @if (undoID()) {<mui-button variant="ghost" [disabled]="disabled()" (pressed)="send('undo')">Undo last change</mui-button>}
 </div>
 @if(mode(); as mode) {<section class="panel" [attr.aria-label]="mode==='later'?'Defer task':'Waiting details'">
 <h3>{{mode==='later'?'When should this return?':'What are you waiting for?'}}</h3>
 @if(mode==='waiting') {<mui-input ariaLabel="Waiting on" [(value)]="waitingOn" placeholder="Person or event" />}
 <label>{{mode==='later'?'Resurface at':'Review again (optional)'}} · your local time <input type="datetime-local" [(ngModel)]="when" [attr.aria-label]="mode==='later'?'Resurface at':'Review again'" /></label>
 @if(afterDeadline()) {<p role="status">This is after the original deadline. The deadline will stay unchanged.</p>}
 @if(mode==='waiting') {<p>When this review time arrives, Maple adds a separate follow-up task. The original obligation stays waiting.</p>}
 <p role="alert" [hidden]="!staleDraft()">Task changed while these details were open. Cancel and reopen the action to review its latest state.</p>
 <div class="actions"><mui-button [disabled]="disabled() || !validDate(mode)" (pressed)="send(mode)">Save {{mode==='later'?'for later':'waiting status'}}</mui-button><mui-button variant="ghost" (pressed)="cancel()">Cancel</mui-button></div>
 </section>}
 <small>These actions update Maple only. No reply is sent.</small>`,
 styles:[`:host{display:block;margin:16px 0}.actions{display:flex;flex-wrap:wrap;gap:8px}label{display:block;margin:16px 0}input{display:block;min-height:44px;margin-top:8px;background:var(--color-bg);color:var(--color-text-main);border:1px solid var(--color-border);border-radius:8px;padding:8px;font:inherit}small{color:var(--color-text-muted)}`]})
export class TaskActionsComponent {
 readonly identity=input('');readonly version=input(0);readonly disabled=input(false);readonly terminal=input(false);readonly waiting=input(false);readonly undoID=input('');readonly deadline=input<number>();
 readonly submitAction=output<TaskActionRequest>();readonly mode=signal<'later'|'waiting'|null>(null);
 waitingOn='';when='';private retry?:{key:string;request:TaskActionRequest};
 private readonly draft=signal<{identity:string;version:number;deadline?:number;waiting:boolean;terminal:boolean}|null>(null);
 readonly staleDraft=computed(()=>{const d=this.draft();return !!d && (d.identity!==this.identity()||d.version!==this.version()||d.waiting!==this.waiting()||d.terminal!==this.terminal());});
 private formIdentity='';
 open(mode:'later'|'waiting'){
  if(this.disabled()||this.terminal()||(mode==='later'&&this.waiting()))return;
  if(this.formIdentity!==this.identity()){this.when='';this.waitingOn='';}
  this.formIdentity=this.identity();
  this.draft.set({identity:this.identity(),version:this.version(),deadline:this.deadline(),waiting:this.waiting(),terminal:this.terminal()});
  this.mode.set(mode);
 }
 cancel(){this.mode.set(null);this.draft.set(null);}
 private target(){const d=this.draft();return {identity:d?.identity??this.identity(),version:d?.version??this.version()};}
 validDate(mode:string){
  if(this.staleDraft())return false;
  if(mode==='waiting'&&(!this.waitingOn.trim()||new TextEncoder().encode(this.waitingOn.trim()).length>512))return false;
  if(mode==='later'&&this.waiting())return false;
  if(!this.when&&mode==='waiting')return true;
  const time=new Date(this.when).getTime();if(!Number.isFinite(time))return false;
  const payload:TaskActionRequest['payload']=mode==='later'?{resurfaceAt:new Date(time).toISOString()}:{waitingOn:this.waitingOn.trim(),reviewAt:new Date(time).toISOString()};
  const key=JSON.stringify({intent:mode,payload,...this.target()});
  return time>Date.now() || this.retry?.key===key;
 }
 afterDeadline(){const deadline=this.draft()?this.draft()!.deadline:this.deadline();return !!this.when && deadline!==undefined && new Date(this.when).getTime()/1000>deadline;}
 send(intent:TaskIntent){
  if(this.disabled() || this.staleDraft() || (this.terminal()&&intent!=='undo') || ((intent==='later'||intent==='waiting')&&!this.validDate(intent)))return;
  const target=this.target();if(!target.identity||!Number.isInteger(target.version)||target.version<1)return;
  const payload:TaskActionRequest['payload']={};
  if(intent==='later')payload.resurfaceAt=new Date(this.when).toISOString();
  if(intent==='waiting'){if(this.waitingOn.trim())payload.waitingOn=this.waitingOn.trim();if(this.when)payload.reviewAt=new Date(this.when).toISOString();}
  if(intent==='undo'){if(!this.undoID())return;payload.targetMutationID=this.undoID();}
  const key=JSON.stringify({intent,payload,...this.target()});
  if(this.retry?.key!==key)this.retry={key,request:{identity:target.identity,expectedVersion:target.version,requestID:crypto.randomUUID(),intent,payload,issuedAt:new Date().toISOString()}};
  this.submitAction.emit(this.retry.request);this.cancel();
 }
 @HostListener('document:keydown',['$event']) key(event:KeyboardEvent){
  const target=event.target instanceof Element ? event.target : null;
  if(this.disabled()||this.terminal()||this.mode()||event.isComposing||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
  const key=event.key.toLowerCase();if(!['e','l','w','delete'].includes(key))return;event.preventDefault();
  if(key==='e')this.send('done');else if(key==='delete')this.send('notNeeded');else if(key!=='l'||!this.waiting())this.open(key==='l'?'later':'waiting');
 }
}
