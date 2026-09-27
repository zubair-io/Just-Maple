import { Component, ChangeDetectionStrategy, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MuiButtonComponent } from '@maple/ui';
import { NativeBridge } from '../core/native-bridge.service';
import { SourceInspectorComponent } from '../sources/source-inspector.component';
import { SourceEvidence } from '../sources/source.models';
export interface InboxCursor {occurredAt:number;eventID:string;snapshotRowID:number;connector?:string}
export interface InboxItem {id:string;connector:string;sender:string;subject:string;preview:string;status:string;statusDetail:string;analysisStatus?:string;occurredAt:number;tags:{id:string;name:string}[]}
export interface InboxPage {items:InboxItem[];nextCursor?:InboxCursor|null;total:number;sources:{connector:string;name:string;count:number}[]}
@Component({selector:'maple-history',standalone:true,imports:[DatePipe,ScrollingModule,MuiButtonComponent,SourceInspectorComponent],changeDetection:ChangeDetectionStrategy.OnPush,
 templateUrl:'./history.component.html',styleUrl:'./history.component.css'})
export class HistoryComponent implements OnInit,OnDestroy {
 readonly connector=signal('');readonly sources=signal<InboxPage['sources']>([]);
 readonly bridge=inject(NativeBridge);readonly rows=signal<InboxItem[]>([]);readonly total=signal(0);readonly loading=signal(false);readonly error=signal('');readonly next=signal<InboxCursor|null>(null);readonly loaded=signal(false);
 readonly source=signal<SourceEvidence|null>(null);readonly sourceLoading=signal(false);readonly sourceError=signal('');
 private generation=0;private sourceRequest=0;private destroyed=false;
 ngOnInit(){void this.refresh();}
 ngOnDestroy(){this.destroyed=true;this.generation++;this.sourceRequest++;}
 readonly track=(_:number,row:InboxItem)=>row.id;
 statusLabel(status:string){return ({processed:'Processed',flagged:'Flagged',waiting:'Waiting',failed:'Needs retry',indexed:'Indexed'} as Record<string,string>)[status] ?? 'Waiting';}
 selectConnector(connector:string){if(connector===this.connector())return;this.generation++;this.connector.set(connector);this.rows.set([]);this.total.set(0);this.loading.set(false);this.closeSource();void this.refresh();}
 async refresh(){if(this.loading())return;this.next.set(null);this.loaded.set(false);await this.page(true);}
 async more(){if(this.loading()||!this.next())return;await this.page(false);}
 nearEnd(index:number){if(index>=this.rows().length-15)void this.more();}
 private async page(replace:boolean){
  const request=++this.generation;this.loading.set(true);this.error.set('');
  try{const page=await this.bridge.historyInbox<InboxPage>(replace?undefined:this.next(),this.connector()||undefined);if(this.destroyed||request!==this.generation)return;
   const items=replace?page.items:[...this.rows(),...page.items];this.rows.set([...new Map(items.map(row=>[row.id,row])).values()]);this.total.set(page.total);this.sources.set(page.sources);this.next.set(page.nextCursor??null);this.loaded.set(true);
  }catch(e){if(!this.destroyed&&request===this.generation)this.error.set(e instanceof Error?e.message:'History could not be loaded. Try again.');}
  finally{if(!this.destroyed&&request===this.generation)this.loading.set(false);}
 }
 async inspect(id:string){const request=++this.sourceRequest;this.source.set(null);this.sourceError.set('');this.sourceLoading.set(true);try{const source=await this.bridge.inspectSource(id);if(!this.destroyed&&request===this.sourceRequest)this.source.set(source);}catch{if(!this.destroyed&&request===this.sourceRequest)this.sourceError.set('Could not open this source. Try again.');}finally{if(!this.destroyed&&request===this.sourceRequest)this.sourceLoading.set(false);}}
 closeSource(){this.sourceRequest++;this.source.set(null);this.sourceLoading.set(false);this.sourceError.set('');}
}
