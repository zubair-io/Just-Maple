import { Injectable, inject, signal } from '@angular/core';
import { companionHost, isCompanion } from '../core/companion-host';
import { NativeBridge } from '../core/native-bridge.service';
import { LocalDraftQueue } from '../notes/local-draft-queue';
export interface Note {path:string;name:string;modifiedAt:number}
export interface Notebook {id:string;name:string;location:string;cloud:boolean;available:boolean;notes:Note[];error?:string}
export interface Catalog {notebooks:Notebook[];cloudAvailable:boolean}
export interface NoteDocument {documentID?:string;readOnly?:boolean;day?:string;notebookID:string;path:string;content:string;revision:string;indexingWarning?:string}
@Injectable({providedIn:'root'})
export class NotebookService {
  readonly bridge=inject(NativeBridge);readonly catalog=signal<Catalog>({notebooks:[],cloudAvailable:false});
  readonly bookID=signal('');readonly document=signal<NoteDocument|null>(null);readonly generation=signal(0);readonly initial=signal('');
  readonly dirty=signal(false);readonly saving=signal(false);readonly status=signal('');readonly error=signal('');readonly loading=signal(false);
  managedFlusher?:()=>Promise<boolean>;
  private async flushAll(){return (!this.managedFlusher||await this.managedFlusher())&&await this.flush();}
  private opening=0;
  private writingGeneration=0;
  private copyWork?:Promise<boolean>;
  private timer?:ReturnType<typeof setTimeout>;private saveWork?:Promise<boolean>;
  private readonly drafts=new LocalDraftQueue<NoteDocument>(async record=>{
    const current=this.document();
    const revision=current?.notebookID===record.notebookID&&current.path===record.path ? current.revision : record.revision;
    await this.request('noteDraft',{record:{...record,revision}});
  },(record,error)=>{
    const current=this.document();
    if(current?.notebookID===record.notebookID&&current.path===record.path){
      this.fail(error);this.status.set('Not saved · draft storage needs attention');
    }
  });
  private enqueueDraft(record:NoteDocument){this.drafts.enqueue(JSON.stringify([record.notebookID,record.path]),record);}
  private ensureDraft(){return this.drafts.flush();}
  private request<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
    if(!isCompanion())return this.bridge.notebook<T>(action,data);
    const host=companionHost();
    if(!host)return Promise.reject(new Error('Your iPhone notebook storage is unavailable. Reopen the app to try again.'));
    return host.postMessage({action,...data}) as Promise<T>;
  }
  async closeNote(){if(!await this.flushAll())return;this.opening++;this.loading.set(false);this.document.set(null);this.status.set('');}
  book(){return this.catalog().notebooks.find(b=>b.id===this.bookID());}
  async refresh(){try {this.catalog.set(await this.request<Catalog>('notebookCatalog'));}catch(e){this.fail(e);}}
  async connect(){if(!await this.flushAll())return;try{this.catalog.set(await this.request<Catalog>('notebookConnect'));}catch(e){this.fail(e);}}
  async disconnect(){const id=this.bookID();if(!await this.flushAll())return;try{this.catalog.set(await this.request<Catalog>('notebookDisconnect',{id}));this.bookID.set('');this.document.set(null);}catch(e){this.fail(e);}}
  async createBook(name:string){try{this.catalog.set(await this.request<Catalog>('notebookCreate',{name}));}catch(e){this.fail(e);}}
  async selectBook(id:string){if(!await this.flushAll())return;this.opening++;this.loading.set(false);this.bookID.set(id);this.document.set(null);this.status.set('');}
  async open(path:string){
    const opening=++this.opening;
    this.loading.set(true);this.error.set('');
    try {
      if(!await this.flushAll()||opening!==this.opening)return;
      const id=this.bookID(),before=this.document(),writing=this.writingGeneration;
      const file=await this.request<NoteDocument>('noteRead',{id,path});
      const draft=await this.request<NoteDocument|null>('noteReadDraft',{id,path});
      if(opening!==this.opening||id!==this.bookID())return;
      const current=this.document();
      if(writing!==this.writingGeneration||this.dirty()||this.saving()||
          current?.notebookID!==before?.notebookID||current?.path!==before?.path||current?.revision!==before?.revision){
        this.error.set('Opening paused because your writing changed. Your current note is preserved; try opening again after it saves.');
        return;
      }
      const recovered=draft&&draft.content!==file.content ? draft:null;
      this.load(recovered?{...recovered,documentID:file.documentID,readOnly:file.readOnly,day:file.day}:file);this.dirty.set(!!recovered);
      this.status.set(recovered?'Recovered unsaved draft. Review and Save, or save a copy.':'Saved');
      if(recovered&&recovered.revision!==file.revision)this.error.set('The file also changed outside Just Maple. Save a copy to keep both versions.');
    }catch(e){if(opening===this.opening)this.fail(e);}
    finally{if(opening===this.opening)this.loading.set(false);}
  }
  load(doc:NoteDocument){this.writingGeneration++;this.document.set(doc);this.initial.set(doc.content);this.generation.update(v=>v+1);this.dirty.set(false);this.error.set('');}
  async createNote(name:string){if(!await this.flushAll())return;try{const doc=await this.request<NoteDocument>('noteCreate',{id:this.bookID(),name});this.load(doc);this.status.set('Saved');await this.refresh();}catch(e){this.fail(e);}}
  change(content:string){
    const doc=this.document();if(!doc||doc.readOnly)return;
    this.writingGeneration++;
    this.document.set({...doc,content});this.dirty.set(true);this.status.set('Saving local draft…');clearTimeout(this.timer);
    // Draft snapshots coalesce per note; a failed newest snapshot remains
    // queued until a later edit or explicit retry succeeds.
    this.enqueueDraft({...doc,content});
    this.timer=setTimeout(()=>void this.flush(),700);
  }
  async flush():Promise<boolean>{
    clearTimeout(this.timer);
    if(this.copyWork){await this.copyWork;if(this.error())return false;}
    if(this.saveWork)return this.saveWork;
    if(this.document()?.readOnly||!this.dirty())return true;
    this.saveWork=(async()=>{
      do{if(!await this.save())return false;}while(this.dirty());
      return true;
    })();
    try{return await this.saveWork;}finally{this.saveWork=undefined;}
  }
  private async save(){
    this.saving.set(true);let draftDurable=false;
    try {
      await this.ensureDraft();draftDurable=true;
      const doc=this.document();if(!doc||doc.readOnly)return true;
      const saved=await this.request<NoteDocument>('noteSave',{id:doc.notebookID,path:doc.path,content:doc.content,revision:doc.revision});
      const latest=this.document();
      if(latest?.path===doc.path&&latest.notebookID===doc.notebookID){
        this.document.set({...saved,content:latest.content});this.dirty.set(latest.content!==doc.content);
        if(this.dirty()){
          draftDurable=false;
          // Keep newer text recoverable against the acknowledged base revision.
          // The next iteration also drains any edits that arrived meanwhile.
          await this.ensureDraft();
          const current=this.document();
          if(current?.path===doc.path&&current.notebookID===doc.notebookID){
            this.enqueueDraft({...current});
            await this.ensureDraft();
            draftDurable=true;
          }
        }
      }
      this.error.set('');this.status.set(this.dirty()?'Saving…':'Saved');return true;
    }catch(e){this.fail(e);this.status.set(draftDurable?'Draft kept · save needs attention':'Not saved · draft storage needs attention');return false;}
    finally{this.saving.set(false);}
  }
  async saveCopy(name:string){
    if(this.copyWork)return this.copyWork;
    const work=this.createCopy(name);this.copyWork=work;
    try{return await work;}finally{this.copyWork=undefined;}
  }
  private async createCopy(name:string){
    clearTimeout(this.timer);if(this.saveWork)await this.saveWork;
    const doc=this.document();if(!doc)return false;
    this.saving.set(true);
    try{
      // A recovery copy must also work when the original file or draft store
      // cannot save. Snapshot current writing directly, keeping its open session.
      const copy=await this.request<NoteDocument>('noteCreate',{id:doc.notebookID,name});
      const saved=await this.request<NoteDocument>('noteSave',{id:copy.notebookID,path:copy.path,revision:copy.revision,content:doc.content});
      const latest=this.document();
      // Do not load the copy or acknowledge the original draft. Edits made during
      // copy I/O stay in the same editor with their existing revision and queue.
      if(latest?.notebookID===doc.notebookID&&latest.path===doc.path){
        const changed=latest.content!==doc.content;
        this.status.set(`Copy saved: ${saved.path} · ${changed?'newer edits remain in this note':'original unchanged'}`);
      }
      await this.refresh();
      return true;
    }catch(e){this.fail(e);this.status.set('Draft kept · copy needs attention');return false;}
    finally{this.saving.set(false);}
  }
  fail(e:unknown){this.error.set(e instanceof Error?e.message:String(e));}
}
