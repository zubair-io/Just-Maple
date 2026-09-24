import { isCompanion } from '../core/companion-host';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MuiButtonComponent,MuiInputComponent } from '@maple/ui';
import { NotebookService } from './notebook.service';
import { MarkdownEditorComponent } from './markdown-editor.component';
@Component({selector:'maple-notebooks',standalone:true,imports:[FormsModule,DatePipe,MuiButtonComponent,MuiInputComponent,MarkdownEditorComponent],templateUrl:'./notebooks.component.html',styleUrl:'./notebooks.component.css'})
export class NotebooksComponent implements OnDestroy {
  readonly companion=isCompanion();
  readonly notes=inject(NotebookService);name='';dialog:''|'book'|'note'|'copy'='';
  private timer=setInterval(()=>void this.notes.refresh(),15000);
  constructor(){void this.notes.refresh();}
  async submit(){if(!this.name.trim())return;this.notes.error.set('');if(this.dialog==='book')await this.notes.createBook(this.name);else if(this.dialog==='copy')await this.notes.saveCopy(this.name);else await this.notes.createNote(this.name);if(!this.notes.error()){this.dialog='';this.name='';}}
  show(dialog:'book'|'note'|'copy'){this.dialog=dialog;this.name='';}
  ngOnDestroy(){clearInterval(this.timer);}
}
