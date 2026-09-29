import { ChangeDetectionStrategy, Component, Injectable, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import { companionHost } from '../core/companion-host';
import { LocalCalendar } from '../core/local-calendar.service';
import { localDay, offsetDay } from '../daily-note/daily-note.models';
import { MapleEditorComponent } from '../editor/maple-editor.component';
import { relativeDayLabel } from '../today/relative-day';

interface PhoneDayDocument {day:string;path:string;content:string;revision:string;readOnly:boolean}

@Injectable({providedIn:'root'})
export class CompanionTodayService {
  readonly day=signal(localDay());
  readonly document=signal<PhoneDayDocument|null>(null);
  readonly loading=signal(false);
  readonly error=signal('');
  private generation=0;
  openToday(){return this.open(localDay());}
  cancel(){this.generation++;this.loading.set(false);}
  async open(day=this.day()) {
    const generation=++this.generation;
    this.day.set(day);this.loading.set(true);this.error.set('');
    // Do not display the previous day's writing beneath a new date chip.
    if(this.document()?.day!==day)this.document.set(null);
    try {
      const host=companionHost();
      if(!host)throw new Error('Open Just Maple on your iPhone to read your iCloud note.');
      const doc=await host.postMessage({action:'todayRead',day}) as PhoneDayDocument;
      if(generation!==this.generation)return;
      if(doc.day!==day || typeof doc.content!=='string' || !doc.revision)throw new Error('The requested day could not be opened. Retry after iCloud finishes syncing.');
      this.document.set(doc);
    } catch(error) {
      if(generation===this.generation)this.error.set(error instanceof Error?error.message:'Could not read this day from iCloud Drive. Retry when connected.');
    } finally {if(generation===this.generation)this.loading.set(false);}
  }
}

@Component({
  selector:'maple-companion-today',standalone:true,
  imports:[MapleEditorComponent,MuiButtonComponent],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`<section aria-label="Daily document">
    <nav aria-label="Your days">
      @for(link of links;track link.label){<mui-button variant="ghost" [attr.aria-current]="notes.day()===target(link.offset)?'page':null" (pressed)="notes.open(target(link.offset))">{{link.label}}</mui-button>}
    </nav>
    <time class="date-chip" [attr.datetime]="notes.day()" [attr.title]="notes.day()">{{label()}}</time>
    @if(notes.loading()){<p role="status">Opening iCloud note…</p>}
    @if(notes.error()){<p role="alert">{{notes.error()}}</p><mui-button variant="ghost" (pressed)="notes.open()">Retry opening note</mui-button>}
    @if(notes.document();as doc){
      <p class="notice">Same iCloud document as your Mac · Read only on iPhone</p>
      @for(revision of [doc.day+':'+doc.revision];track revision){
        <maple-editor [initial]="doc.content" [readOnly]="true" [showToolbar]="false" />
      }
    }
  </section>`,
  styles:[`nav{display:flex;gap:4px;margin-bottom:18px}.date-chip{display:inline-block;border-radius:20px;padding:6px 12px;background:var(--color-bg-secondary);font-size:13px}.notice{font-size:12px;color:var(--color-text-muted);margin:12px 0 24px}section{min-width:0}maple-editor{display:block;min-width:0}`]
})
export class CompanionTodayComponent implements OnInit,OnDestroy {
  readonly notes=inject(CompanionTodayService);
  readonly calendar=inject(LocalCalendar);
  readonly links=[{label:'Yesterday',offset:-1},{label:'Today',offset:0},{label:'Tomorrow',offset:1}];
  private timer?:ReturnType<typeof setInterval>;
  target(offset:number){return offsetDay(this.calendar.today(),offset);}
  label(){return relativeDayLabel(this.notes.day(),this.calendar.today());}
  private readonly refresh=()=>{if(!document.hidden&&!this.notes.loading())void this.notes.open();};
  ngOnInit(){void this.notes.openToday();this.timer=setInterval(this.refresh,15000);window.addEventListener('focus',this.refresh);document.addEventListener('visibilitychange',this.refresh);}
  ngOnDestroy(){clearInterval(this.timer);window.removeEventListener('focus',this.refresh);document.removeEventListener('visibilitychange',this.refresh);this.notes.cancel();}
}
