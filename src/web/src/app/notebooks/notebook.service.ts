import { Injectable, inject, signal } from '@angular/core';
import { companionHost, isCompanion } from '../core/companion-host';
import { NativeBridge } from '../core/native-bridge.service';
export interface Note {path:string;name:string;modifiedAt:number}
export interface Notebook {id:string;name:string;location:string;cloud:boolean;available:boolean;notes:Note[];error?:string}
export interface Catalog {notebooks:Notebook[];cloudAvailable:boolean}
export interface NoteDocument {notebookID:string;path:string;content:string;revision:string;indexingWarning?:string}
@Injectable({providedIn:'root'})
export class NotebookService {
  readonly bridge=inject(NativeBridge);readonly catalog=signal<Catalog>({notebooks:[],cloudAvailable:false});
  readonly bookID=signal('');readonly document=signal<NoteDocument|null>(null);readonly generation=signal(0);readonly initial=signal('');
  readonly dirty=signal(false);readonly saving=signal(false);readonly status=signal('');readonly error=signal('');readonly loading=signal(false);
  private opening=0;
  private copyWork?:Promise<void>;
  private timer?:ReturnType<typeof setTimeout>;private saveWork?:Promise<boolean>;private draftWork:Promise<unknown>=Promise.resolve();
  private request<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
    if(!isCompanion())return this.bridge.notebook<T>(action,data);
    const host=companionHost();
    if(!host)return Promise.reject(new Error('Your iPhone notebook storage is unavailable. Reopen the app to try again.'));
    return host.postMessage({action,...data}) as Promise<T>;
  }
  async closeNote(){if(!await this.flush())return;this.opening++;this.loading.set(false);this.document.set(null);this.status.set('');}
  book(){return this.catalog().notebooks.find(b=>b.id===this.bookID());}
  async refresh(){try {this.catalog.set(await this.request<Catalog>('notebookCatalog'));}catch(e){this.fail(e);}}
  async connect(){if(!await this.flush())return;try{this.catalog.set(await this.request<Catalog>('notebookConnect'));}catch(e){this.fail(e);}}
  async disconnect(){const id=this.bookID();if(!await this.flush())return;try{this.catalog.set(await this.request<Catalog>('notebookDisconnect',{id}));this.bookID.set('');this.document.set(null);}catch(e){this.fail(e);}}
  async createBook(name:string){try{this.catalog.set(await this.request<Catalog>('notebookCreate',{name}));}catch(e){this.fail(e);}}
  async selectBook(id:string){if(!await this.flush())return;this.opening++;this.loading.set(false);this.bookID.set(id);this.document.set(null);this.status.set('');}
  async open(path:string){if(!await this.flush())return;this.loading.set(true);this.error.set('');const opening=++this.opening;try {
    const id=this.bookID(),file=await this.request<NoteDocument>('noteRead',{id,path});
    const draft=await this.request<NoteDocument|null>('noteReadDraft',{id,path});
    if(opening!==this.opening)return;
    const recovered=draft&&draft.content!==file.content ? draft:null;
    this.load(recovered??file);this.dirty.set(!!recovered);
    this.status.set(recovered?'Recovered unsaved draft. Review and Save, or save a copy.':'Saved');
    if(recovered&&recovered.revision!==file.revision)this.error.set('The file also changed outside Just Maple. Save a copy to keep both versions.');
  }catch(e){if(opening===this.opening)this.fail(e);}finally{if(opening===this.opening)this.loading.set(false);}}
  load(doc:NoteDocument){this.document.set(doc);this.initial.set(doc.content);this.generation.update(v=>v+1);this.dirty.set(false);this.error.set('');}
  async createNote(name:string){if(!await this.flush())return;try{const doc=await this.request<NoteDocument>('noteCreate',{id:this.bookID(),name});this.load(doc);this.status.set('Saved');await this.refresh();}catch(e){this.fail(e);}}
  change(content:string){const doc=this.document();if(!doc)return;this.document.set({...doc,content});this.dirty.set(true);this.status.set('Saving…');clearTimeout(this.timer);
    const record={...doc,content};this.draftWork=this.draftWork.catch(()=>{}).then(()=>this.request('noteDraft',{record})).catch(e=>{this.fail(e);});
    this.timer=setTimeout(()=>void this.flush(),700);
  }
  async flush():Promise<boolean>{clearTimeout(this.timer);if(this.copyWork){await this.copyWork;if(this.error())return false;}if(this.saveWork){await this.saveWork;if(this.error())return false;}if(!this.dirty())return true;
    this.saveWork=this.save();const ok=await this.saveWork;this.saveWork=undefined;if(ok&&this.dirty())return this.flush();return ok;
  }
  private async save(){const doc=this.document();if(!doc)return true;this.saving.set(true);try {
    await this.draftWork;
    const saved=await this.request<NoteDocument>('noteSave',{id:doc.notebookID,path:doc.path,content:doc.content,revision:doc.revision});
    const latest=this.document();if(latest?.path===doc.path&&latest.notebookID===doc.notebookID){this.document.set({...saved,content:latest.content});this.dirty.set(latest.content!==doc.content);if(this.dirty()){const record={...saved,content:latest.content};await this.request('noteDraft',{record});}}
    this.error.set('');this.status.set(this.dirty()?'Saving…':'Saved');return true;
  }catch(e){this.fail(e);this.status.set('Draft kept · save needs attention');return false;}finally{this.saving.set(false);}}
  async saveCopy(name:string){
    if(this.copyWork)return this.copyWork;
    const work=this.createCopy(name);this.copyWork=work;
    try{await work;}finally{this.copyWork=undefined;}
  }
  private async createCopy(name:string){
    clearTimeout(this.timer);if(this.saveWork)await this.saveWork;
    const doc=this.document();if(!doc)return;
    this.saving.set(true);
    try{
      await this.draftWork;
      const copy=await this.request<NoteDocument>('noteCreate',{id:doc.notebookID,name});
      const saved=await this.request<NoteDocument>('noteSave',{id:copy.notebookID,path:copy.path,revision:copy.revision,content:doc.content});
      const latest=this.document();
      // Navigation waits for copyWork. Preserve edits made while native I/O was in flight.
      if(latest?.notebookID===doc.notebookID&&latest.path===doc.path){
        const changed=latest.content!==doc.content;
        const merged={...saved,content:latest.content};
        this.load(merged);this.dirty.set(changed);
        if(changed){
          await this.draftWork;
          await this.request('noteDraft',{record:merged});
          this.status.set('Copy saved · newer edits kept');
          clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),700);
        }else this.status.set('Copy saved; original unchanged');
      }
      await this.refresh();
    }catch(e){this.fail(e);this.status.set('Draft kept · copy needs attention');}
    finally{this.saving.set(false);}
  }
  fail(e:unknown){this.error.set(e instanceof Error?e.message:String(e));}
}
