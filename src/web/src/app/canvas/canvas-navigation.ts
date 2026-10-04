import { AfterViewInit, Directive, ElementRef, OnDestroy, effect, untracked, inject, input } from '@angular/core';
import { DailyCanvas } from './daily-canvas';

export function zoomAnchor(scroll: number, point: number, before: number, after: number, origin = 0) {
  return Math.max(0, (scroll + point - origin) / before * after + origin - point);
}
export function boundedZoom(value: number) { return Math.max(.2, Math.min(2.5, value)); }
/** Camera gestures change only the view; writing and document revisions are untouched. */
@Directive({ selector: '[mapleCanvasNavigation]', standalone: true })
export class CanvasNavigation implements AfterViewInit, OnDestroy {
  readonly mapleCanvasNavigation = input.required<DailyCanvas>();
  private readonly element = inject(ElementRef<HTMLElement>);
  private focusCamera?: {left:number;top:number;zoom:number};
  private focusFrame=0;
  constructor(){effect(()=>{
    const canvas=this.mapleCanvasNavigation(),focused=canvas.focused();canvas.writingFont();canvas.writingSize();
    untracked(()=>{
      const el=this.element.nativeElement;
      if(focused){if(!this.focusCamera)this.focusCamera={left:el.scrollLeft,top:el.scrollTop,zoom:canvas.zoom()};canvas.zoom.set(1);if(this.focusFrame)cancelAnimationFrame(this.focusFrame);this.focusFrame=requestAnimationFrame(()=>{this.focusFrame=0;el.scrollLeft=0;el.scrollTop=0;el.closest('maple-editor')?.scrollIntoView?.({block:'start'});});}
      else if(this.focusCamera){const previous=this.focusCamera;this.focusCamera=undefined;canvas.zoom.set(previous.zoom);if(this.focusFrame)cancelAnimationFrame(this.focusFrame);this.focusFrame=requestAnimationFrame(()=>{this.focusFrame=0;el.scrollLeft=previous.left;el.scrollTop=previous.top;});}
    });
  });}
  private cleanups: (()=>void)[]=[];
  private space=false;
  private dragging=false;
  private frame=0;
  private pending?: {left:number;top:number};
  private gestureZoom=1;
  private touches = new Map<number,{x:number;y:number}>();
  private marquee?: {x:number;y:number;additive:boolean};
  private pinch?: {distance:number;zoom:number};
  private origin() {
    const space=this.element.nativeElement.querySelector('.canvas-camera-space');
    const style=space ? getComputedStyle(space) : undefined;
    return {x:parseFloat(style?.paddingLeft ?? '0') || 0,y:parseFloat(style?.paddingTop ?? '0') || 0};
  }
  private get enabled() { return this.mapleCanvasNavigation().active() && !this.mapleCanvasNavigation().focused(); }
  ngAfterViewInit() {
    const el=this.element.nativeElement;
    const listen=(target:EventTarget,type:string,handler:EventListener)=>{
      target.addEventListener(type,handler,{passive:false});this.cleanups.push(()=>target.removeEventListener(type,handler));
    };
    listen(el,'wheel',((event:WheelEvent)=>{
      if(!this.enabled || !(event.ctrlKey||event.metaKey)) return;
      event.preventDefault();
      this.zoomAt(this.mapleCanvasNavigation().zoom()*Math.exp(-event.deltaY*.008),event.clientX,event.clientY);
    }) as EventListener);
    listen(el,'gesturestart',((event:Event)=>{if(this.enabled){event.preventDefault();this.gestureZoom=this.mapleCanvasNavigation().zoom();}}) as EventListener);
    listen(el,'gesturechange',((event:Event)=>{
      if(!this.enabled) return;
      event.preventDefault();const gesture=event as Event & {scale:number;clientX:number;clientY:number};
      if(Number.isFinite(gesture.scale)) this.zoomAt(this.gestureZoom*gesture.scale,gesture.clientX,gesture.clientY);
    }) as EventListener);
    listen(el,'gestureend',((event:Event)=>{if(this.enabled)event.preventDefault();}) as EventListener);
    listen(window,'keydown',((event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(event.code==='Space' && this.enabled && !target.closest('input,textarea,select,[contenteditable="true"],button')){
        event.preventDefault();this.space=true;el.classList.add('canvas-pan-ready');
      }
    }) as EventListener);
    const reset=()=>{this.space=false;this.dragging=false;this.touches.clear();this.pinch=undefined;this.marquee=undefined;this.mapleCanvasNavigation().selectionBox.set(null);el.classList.remove('canvas-pan-ready','canvas-panning');};
    listen(window,'keyup',((e:KeyboardEvent)=>{if(e.code==='Space')reset();}) as EventListener);
    listen(window,'blur',reset);
    listen(el,'pointerdown',((event:PointerEvent)=>{
      if(!this.enabled) return;
      if(event.pointerType==='touch'){
        this.touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(this.touches.size===2){event.preventDefault();const [a,b]=[...this.touches.values()];this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.mapleCanvasNavigation().zoom()};}
      }
      if(event.button!==1 && !(this.space&&event.button===0)) {
        if(event.button===0 && event.pointerType!=='touch' && !(event.target as HTMLElement).closest('button,input,textarea,select,.maple-canvas-card,.canvas-group,.canvas-connection-hit')){
          const rect=el.getBoundingClientRect(),zoom=this.mapleCanvasNavigation().zoom();
          el.focus({preventScroll:true});
          this.marquee={x:(event.clientX-rect.left+el.scrollLeft-this.origin().x)/zoom,y:(event.clientY-rect.top+el.scrollTop-this.origin().y)/zoom,additive:event.shiftKey};
          event.preventDefault();el.setPointerCapture?.(event.pointerId);
        }
        return;
      }
      event.preventDefault();this.dragging=true;el.classList.add('canvas-panning');el.setPointerCapture?.(event.pointerId);
    }) as EventListener);
    listen(el,'pointermove',((event:PointerEvent)=>{
      if(this.touches.has(event.pointerId)){
        this.touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(this.pinch&&this.touches.size===2){event.preventDefault();const[a,b]=[...this.touches.values()];this.zoomAt(this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance),(a.x+b.x)/2,(a.y+b.y)/2);}
      }
      if(this.marquee){
        const rect=el.getBoundingClientRect(),zoom=this.mapleCanvasNavigation().zoom(),x=(event.clientX-rect.left+el.scrollLeft-this.origin().x)/zoom,y=(event.clientY-rect.top+el.scrollTop-this.origin().y)/zoom;
        this.mapleCanvasNavigation().selectionBox.set({x:Math.min(x,this.marquee.x),y:Math.min(y,this.marquee.y),width:Math.abs(x-this.marquee.x),height:Math.abs(y-this.marquee.y)});
      }
      if(this.dragging){event.preventDefault();el.scrollLeft-=event.movementX;el.scrollTop-=event.movementY;}
    }) as EventListener);
    const end=(event:PointerEvent)=>{const canvas=this.mapleCanvasNavigation(),box=canvas.selectionBox();if(this.marquee&&event.type!=='pointercancel'){if(box)canvas.selectRegion(box,this.marquee.additive);else if(!this.marquee.additive)canvas.selectNone();}this.marquee=undefined;canvas.selectionBox.set(null);this.touches.delete(event.pointerId);this.pinch=undefined;this.dragging=false;el.classList.remove('canvas-panning');if(el.hasPointerCapture?.(event.pointerId))el.releasePointerCapture(event.pointerId);};
    listen(window,'pointerup',end as EventListener);listen(window,'pointercancel',end as EventListener);
  }
  zoomAt(value:number,clientX:number,clientY:number){
    const el=this.element.nativeElement,canvas=this.mapleCanvasNavigation(),before=canvas.zoom(),after=boundedZoom(value),rect=el.getBoundingClientRect();
    if(!Number.isFinite(after))return;
    const x=Number.isFinite(clientX)?clientX-rect.left:rect.width/2,y=Number.isFinite(clientY)?clientY-rect.top:rect.height/2;
    const scroll=this.pending??{left:el.scrollLeft,top:el.scrollTop};
    this.pending={left:zoomAnchor(scroll.left,x,before,after,this.origin().x),top:zoomAnchor(scroll.top,y,before,after,this.origin().y)};
    canvas.zoom.set(after);
    if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.pending){el.scrollLeft=this.pending.left;el.scrollTop=this.pending.top;this.pending=undefined;}});
  }
  ngOnDestroy(){this.cleanups.forEach(stop=>stop());if(this.frame)cancelAnimationFrame(this.frame);if(this.focusFrame)cancelAnimationFrame(this.focusFrame);}
}
