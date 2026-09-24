import { describe,it,expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { markdownBodyToDoc } from './sugar-editor/markdown-to-document';
import { docToMarkdown } from './sugar-editor/document-to-markdown';
import { getTableExtensions } from './sugar-editor/table-extension';
import { splitMarkdown,requiresSource } from './markdown-editor.component';
describe('Copied Sugar Maple Markdown engine',()=>{
 it('round trips headings, emphasis, lists, checklists, code and tables',()=>{
 const raw='# Morning\n\n**Bold** and *quiet*.\n\n- First\n- Second\n\n- [x] Done\n- [ ] Next\n\n```js\nconst x = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n';
 const doc=markdownBodyToDoc(raw);const editor=new Editor({element:document.createElement('div'),extensions:[StarterKit,TaskList,TaskItem,...getTableExtensions()],content:doc});
 const out=docToMarkdown(editor.getJSON());
 for(const text of ['# Morning','**Bold**','*quiet*','First','[x] Done','[ ] Next','const x = 1;','One','Two'])expect(out).toContain(text);
 expect(out).not.toContain('undefined');editor.destroy();
 });
 it('preserves literal Markdown punctuation and code fence contents',()=>{
 const text='literal *stars* [brackets] and `ticks`';const serialized=docToMarkdown({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
 const parsed=markdownBodyToDoc(serialized);expect(parsed.content?.[0].content?.map(n=>n.text).join('')).toBe(text);
 const block=docToMarkdown({type:'doc',content:[{type:'codeBlock',content:[{type:'text',text:'```inside```'}]}]});expect(block.startsWith('````')).toBe(true);
 });
 it('preserves frontmatter verbatim and protects extended Markdown',()=>{
 const prefix='---\r\ntitle: Morning\r\ncustom: keep-this\r\n---\r\n';expect(splitMarkdown(prefix+'# Note').prefix).toBe(prefix);
 for(const source of ['<div>raw HTML</div>','![image](photo.png)','[[local-link]]','```maple:embed\n{}\n```'])expect(requiresSource(source)).toBe(true);
 expect(requiresSource('# Normal\n\n- List')).toBe(false);
 });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NativeBridge } from '../core/native-bridge.service';
import { NotebookService } from './notebook.service';
describe('Notebook draft persistence',()=>{
 it('keeps unsaved text after an external-edit conflict',async()=>{
  const notebook=vi.fn(async(action:string)=>{if(action==='noteSave')throw Error('External edit conflict');return {saved:true};});
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook}}]});
  const service=TestBed.inject(NotebookService);service.load({notebookID:'book',path:'note.md',revision:'v1',content:'Original'});
  service.change('My unsaved text');expect(await service.flush()).toBe(false);
  expect(service.document()?.content).toBe('My unsaved text');expect(service.dirty()).toBe(true);
  expect(notebook).toHaveBeenCalledWith('noteDraft',expect.objectContaining({record:expect.objectContaining({content:'My unsaved text'})}));TestBed.resetTestingModule();
 });
 it('serializes edits made while a save is in flight using the new revision',async()=>{
  let resolveFirst!:(value:unknown)=>void;const saves:Record<string,unknown>[]=[];
  const notebook=vi.fn(async(action:string,data:Record<string,unknown>)=>{
   if(action!=='noteSave')return {saved:true};saves.push(data);
   if(saves.length===1)return await new Promise(resolve=>resolveFirst=resolve);
   return {notebookID:'book',path:'note.md',revision:'v3',content:data['content']};
  });
  TestBed.configureTestingModule({providers:[{provide:NativeBridge,useValue:{notebook}}]});
  const service=TestBed.inject(NotebookService);service.load({notebookID:'book',path:'note.md',revision:'v1',content:'Original'});
  service.change('First edit');const saving=service.flush();await vi.waitFor(()=>expect(saves.length).toBe(1));
  service.change('Second edit');resolveFirst({notebookID:'book',path:'note.md',revision:'v2',content:'First edit'});
  expect(await saving).toBe(true);expect(saves[1]['revision']).toBe('v2');expect(service.document()?.content).toBe('Second edit');expect(service.dirty()).toBe(false);TestBed.resetTestingModule();
 });
});
