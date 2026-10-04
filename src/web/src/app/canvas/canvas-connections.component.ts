import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DailyCanvas } from './daily-canvas';
import { MuiButtonComponent } from '@maple/ui';
@Component({selector:'maple-canvas-connections',standalone:true,imports:[MuiButtonComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 template:`<aside class="canvas-graph-panel" aria-label="Focused connections">
  <header><div><h2>Connections</h2><p>Your links around the selected card · up to two steps</p></div><mui-button variant="ghost" (pressed)="canvas().graphOpen.set(false)">Close connections</mui-button></header>
  <div class="canvas-graph-map" [style.height.px]="height()">
    <svg [attr.viewBox]="'0 0 840 ' + height()" role="img" aria-label="Authored relationship graph">
      @for(link of links();track link.id){<path [attr.d]="path(link.from,link.to)" class="graph-edge" /><text [attr.x]="mid(link.from,link.to).x" [attr.y]="mid(link.from,link.to).y-10">{{link.label || 'Your link'}}</text>}
    </svg>
    @for(card of canvas().graphCards();track card.id;let i=$index){
      <button type="button" class="graph-node" [class.root]="card.id===canvas().selected()[0]" [style.left.%]="position(i).x / 8.4" [style.top.px]="position(i).y" (click)="canvas().focus(card.id)"><small>{{card.type === 'blockquote' ? 'Writing' : card.type}}</small><strong>{{card.label}}</strong><span>Open card ↗</span></button>
    }
  </div>
  @if(!links().length){<p class="graph-empty">Select two cards on the canvas and choose Connect cards to make their relationship visible.</p>}
  <section class="graph-evidence"><h3>Captured references</h3>
    @for(card of canvas().graphCards();track card.id){
      @if(card.eventID){<button type="button" (click)="inspected.emit(card.eventID!)">Inspect source · {{card.label}} <small>Evidence ID: {{card.eventID}}</small></button>}
      @if(card.taskID){<p>Linked task · {{card.taskID}}<small>Open its card to review task details.</small></p>}
    }
    <p>Lines are links you created. Sources retain their original evidence; group membership does not imply a relationship.</p>
  </section>
 </aside>`})
export class CanvasConnectionsComponent {
 readonly canvas=input.required<DailyCanvas>();
 readonly readOnly=input(false);
 readonly inspected=output<string>();
 readonly links=computed(()=>{const ids=new Set(this.canvas().graphCards().map(c=>c.id));return (this.canvas().layout().connections??[]).filter(l=>ids.has(l.from)&&ids.has(l.to));});
 readonly height=computed(()=>Math.max(250,Math.ceil(this.canvas().graphCards().length/3)*170+60));
 position(i:number){return {x:30+(i%3)*275,y:30+Math.floor(i/3)*170};}
 point(id:string){const i=this.canvas().graphCards().findIndex(c=>c.id===id),p=this.position(Math.max(0,i));return{x:p.x+115,y:p.y+60};}
 path(a:string,b:string){const x=this.point(a),y=this.point(b);return `M ${x.x} ${x.y} L ${y.x} ${y.y}`;}
 mid(a:string,b:string){const x=this.point(a),y=this.point(b);return{x:(x.x+y.x)/2,y:(x.y+y.y)/2};}
}
