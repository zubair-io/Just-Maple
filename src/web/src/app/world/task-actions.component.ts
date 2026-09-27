import { ChangeDetectionStrategy, Component, HostListener, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MuiButtonComponent, MuiInputComponent } from '@maple/ui';
export type TaskIntent = 'done'|'later'|'waiting'|'notNeeded'|'undo';
export interface TaskActionRequest {requestID:string;intent:TaskIntent;issuedAt:string;payload:{resurfaceAt?:string;reviewAt?:string;waitingOn?:string;targetMutationID?:string}}
@Component({selector:'maple-task-actions',standalone:true,imports:[FormsModule,MuiButtonComponent,MuiInputComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<div class="actions">
 @if (!terminal()) {<mui-button variant="primary" [disabled]="disabled()" (pressed)="send('done')">Done</mui-button>@if(!waiting()){<mui-button [disabled]="disabled()" (pressed)="mode.set('later')">Later</mui-button>}<mui-button [disabled]="disabled()" (pressed)="mode.set('waiting')">Waiting</mui-button><mui-button variant="ghost" [disabled]="disabled()" (pressed)="send('notNeeded')">Not needed</mui-button>}
 @if (undoID()) {<mui-button variant="ghost" [disabled]="disabled()" (pressed)="send('undo')">Undo last change</mui-button>}
 </div>
 @if(mode(); as mode) {<section class="panel" [attr.aria-label]="mode==='later'?'Defer task':'Waiting details'">
 <h3>{{mode==='later'?'When should this return?':'What are you waiting for?'}}</h3>
 @if(mode==='waiting') {<mui-input ariaLabel="Waiting on" [(value)]="waitingOn" placeholder="Person or event" />}
 <label>{{mode==='later'?'Resurface at':'Review again (optional)'}} · your local time <input type="datetime-local" [(ngModel)]="when" [attr.aria-label]="mode==='later'?'Resurface at':'Review again'" /></label>
 @if(mode==='later' && afterDeadline()) {<p role="status">This is after the original deadline. The deadline will stay unchanged.</p>}
 @if(mode==='waiting') {<p>A review time is saved with this task. Automatic follow-up reminders are not available yet.</p>}
 <div class="actions"><mui-button [disabled]="disabled() || !validDate(mode)" (pressed)="send(mode)">Save {{mode==='later'?'for later':'waiting status'}}</mui-button><mui-button variant="ghost" (pressed)="cancel()">Cancel</mui-button></div>
 </section>}
 <small>These actions update Maple only. No reply is sent.</small>`,
 styles:[`:host{display:block;margin:16px 0}.actions{display:flex;flex-wrap:wrap;gap:8px}label{display:block;margin:16px 0}input{display:block;min-height:44px;margin-top:8px;background:var(--color-bg);color:var(--color-text-main);border:1px solid var(--color-border);border-radius:8px;padding:8px;font:inherit}small{color:var(--color-text-muted)}`]})
export class TaskActionsComponent {
 readonly identity=input('');readonly version=input(0);readonly disabled=input(false);readonly terminal=input(false);readonly waiting=input(false);readonly undoID=input('');readonly deadline=input<number>();
 readonly submitAction=output<TaskActionRequest>();readonly mode=signal<'later'|'waiting'|null>(null);
 waitingOn='';when='';private retry?:{key:string;request:TaskActionRequest};
 cancel(){this.mode.set(null);}
 validDate(mode:string){
  if(mode==='waiting'&&(!this.waitingOn.trim()||new TextEncoder().encode(this.waitingOn.trim()).length>512))return false;
  if(mode==='later'&&this.waiting())return false;
  if(!this.when&&mode==='waiting')return true;
  const time=new Date(this.when).getTime();if(!Number.isFinite(time))return false;
  const payload:TaskActionRequest['payload']=mode==='later'?{resurfaceAt:new Date(time).toISOString()}:{waitingOn:this.waitingOn.trim(),reviewAt:new Date(time).toISOString()};
  const key=JSON.stringify({intent:mode,payload,identity:this.identity(),version:this.version()});
  return time>Date.now() || this.retry?.key===key;
 }
 afterDeadline(){return !!this.when && this.deadline()!==undefined && new Date(this.when).getTime()/1000>this.deadline()!;}
 send(intent:TaskIntent){
  if(this.disabled() || ((intent==='later'||intent==='waiting')&&!this.validDate(intent)))return;
  const payload:TaskActionRequest['payload']={};
  if(intent==='later')payload.resurfaceAt=new Date(this.when).toISOString();
  if(intent==='waiting'){if(this.waitingOn.trim())payload.waitingOn=this.waitingOn.trim();if(this.when)payload.reviewAt=new Date(this.when).toISOString();}
  if(intent==='undo'){if(!this.undoID())return;payload.targetMutationID=this.undoID();}
  const key=JSON.stringify({intent,payload,identity:this.identity(),version:this.version()});
  if(this.retry?.key!==key)this.retry={key,request:{requestID:crypto.randomUUID(),intent,payload,issuedAt:new Date().toISOString()}};
  this.submitAction.emit(this.retry.request);this.mode.set(null);
 }
 @HostListener('document:keydown',['$event']) key(event:KeyboardEvent){
  const target=event.target instanceof Element ? event.target : null;
  if(this.disabled()||this.terminal()||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
  const key=event.key.toLowerCase();if(!['e','l','w','delete'].includes(key))return;event.preventDefault();
  if(key==='e')this.send('done');else if(key==='delete')this.send('notNeeded');else if(key!=='l'||!this.waiting())this.mode.set(key==='l'?'later':'waiting');
 }
}
