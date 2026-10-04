import {Component,signal,inject} from '@angular/core';
import {MuiButtonComponent} from '@maple/ui';
import {NativeBridge} from '../core/native-bridge.service';
interface BoardExclusion {id:string;label:string;connector:string;account:string;scope:string}
@Component({selector:'maple-board-exclusions',standalone:true,imports:[MuiButtonComponent],template:`
<section class="panel" aria-label="Ignored messages"><h3>Ignored messages</h3>
<p>Matching messages stay in Sources but do not appear automatically on your boards. Linked tasks keep their own status.</p>
@if(error()){<p role="alert">{{error()}}</p><mui-button variant="ghost" (pressed)="load()">Retry ignored messages</mui-button>}
@for(rule of rules();track rule.id){<div class="ignored-rule"><div><strong>{{rule.label}}</strong><small>{{rule.connector==='*'?'All email accounts':rule.connector+' · '+rule.account}}</small></div><mui-button variant="ghost" [disabled]="busy()" (pressed)="remove(rule.id)">Stop ignoring</mui-button></div>}
@if(!rules().length && !loading() && !error()){<p>No messages are ignored. Use a source card’s ⋯ menu to add a rule.</p>}
</section>`,styles:[`.ignored-rule{display:flex;align-items:center;gap:16px;border-top:1px solid var(--color-border);padding:12px 0}.ignored-rule>div{flex:1;overflow-wrap:anywhere}.ignored-rule small{display:block;color:var(--color-text-muted);font-size:12px}`]})
export class BoardExclusionsComponent {
 readonly bridge=inject(NativeBridge);readonly rules=signal<BoardExclusion[]>([]);readonly error=signal('');readonly loading=signal(false);readonly busy=signal(false);
 constructor(){void this.load();}
 async load(){this.loading.set(true);this.error.set('');try{this.rules.set(await this.bridge.notebook<BoardExclusion[]>('boardExclusions'));}catch{this.error.set('Could not load ignored messages. Your existing rules remain saved.');}finally{this.loading.set(false);}}
 async remove(id:string){if(this.busy())return;this.busy.set(true);try{await this.bridge.notebook('boardRemoveExclusion',{id});await this.load();}catch{this.error.set('Could not remove this rule. Try again.');}finally{this.busy.set(false);}}
}
