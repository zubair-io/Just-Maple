import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, input, output, signal, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { MuiButtonComponent } from '@maple/ui';
import { MarkdownPaste } from './sugar-editor/markdown-paste';
import { EmojiReplacer } from './sugar-editor/emoji-replacer';
import { getTableExtensions } from './sugar-editor/table-extension';
import { CodeBlockWithLanguage } from './sugar-editor/code-block-with-language';
import { markdownBodyToDoc } from './sugar-editor/markdown-to-document';
import { docToMarkdown } from './sugar-editor/document-to-markdown';

export function splitMarkdown(raw:string) { const match=raw.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n/);return {prefix:match?.[0] ?? '',body:raw.slice(match?.[0].length ?? 0)}; }
export function requiresSource(raw:string) {
  // Preserve formats outside the extracted standard-Markdown schema verbatim.
  return /<\/?[a-z!]|!\[|\[\[|```maple:|\{(?:id|priority|due|color)[:=]|^\[\^[^\]]+\]:|^\$\$/im.test(splitMarkdown(raw).body);
}
@Component({selector:'maple-markdown-editor',standalone:true,imports:[FormsModule,MuiButtonComponent],encapsulation:ViewEncapsulation.None,template:`
<div class="markdown-tools" aria-label="Markdown formatting">
  <mui-button variant="ghost" (pressed)="toggleSource()">{{source() ? 'Formatted' : 'Markdown'}}</mui-button>
  @if (!source()) {
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleBold().run()">Bold</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleItalic().run()">Italic</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleHeading({level:2}).run()">Heading</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleBulletList().run()">List</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleTaskList().run()">Checklist</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().toggleCodeBlock().run()">Code</mui-button>
    <mui-button variant="ghost" (pressed)="editor!.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()">Table</mui-button>
  }
</div>
@if (notice()) {<p class="editor-notice">{{notice()}}</p>}
<div #surface class="sugar-markdown" [hidden]="source()"></div>
@if (source()) {<textarea class="markdown-source" aria-label="Markdown source" [ngModel]="raw" (ngModelChange)="sourceChanged($event)" spellcheck="false"></textarea>}
`})
export class MarkdownEditorComponent implements AfterViewInit,OnDestroy {
  readonly initial=input.required<string>();readonly changed=output<string>();
  @ViewChild('surface',{static:true}) surface!:ElementRef<HTMLElement>;
  readonly source=signal(false);readonly notice=signal('');raw='';prefix='';editor?:Editor;
  ngAfterViewInit(){this.raw=this.initial();this.prefix=splitMarkdown(this.raw).prefix;this.source.set(requiresSource(this.raw));if(this.source())this.notice.set('This note uses extended Markdown. Source mode preserves it exactly.');this.mount();}
  mount(){
    this.editor?.destroy();
    this.editor=new Editor({element:this.surface.nativeElement,extensions:[StarterKit.configure({codeBlock:false,link:{openOnClick:false}}),Placeholder.configure({placeholder:'Write something worth keeping…'}),CodeBlockWithLanguage,EmojiReplacer,MarkdownPaste,TaskList,TaskItem.configure({nested:true}),...getTableExtensions()],content:this.source() ? '' : markdownBodyToDoc(splitMarkdown(this.raw).body),editorProps:{attributes:{role:'textbox','aria-label':'Note editor','aria-multiline':'true'},handleKeyDown:(_,event)=>{if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();return true;}return false;}},onUpdate:()=>{this.raw=this.prefix+docToMarkdown(this.editor!.getJSON());this.changed.emit(this.raw);}});
  }
  sourceChanged(raw:string){this.raw=raw;this.prefix=splitMarkdown(raw).prefix;this.changed.emit(raw);}
  toggleSource(){if(this.source()&&requiresSource(this.raw)){this.notice.set('Keep source mode for this note’s extended Markdown; nothing has been removed.');return;}this.source.update(v=>!v);this.notice.set('');if(!this.source())this.mount();}
  ngOnDestroy(){this.editor?.destroy();}
}
