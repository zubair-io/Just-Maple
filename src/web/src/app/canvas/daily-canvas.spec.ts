import { TestBed, ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapleEditorComponent } from '../editor/maple-editor.component';
import { decodeDaily } from '../editor/daily-markdown-codec';
import { readCanvas } from './canvas-layout';
let fixture: ComponentFixture<MapleEditorComponent> | undefined;
function mount(raw='<!-- maple:block {"v":1,"id":"one"} -->\nFirst thought.\n\n<!-- maple:block {"v":1,"id":"two"} -->\nSecond thought.\n') {
  fixture=TestBed.createComponent(MapleEditorComponent);
  fixture.componentRef.setInput('initial',raw);fixture.componentRef.setInput('supportsCanvas',true);fixture.componentRef.setInput('documentID','daily');fixture.detectChanges();return fixture.componentInstance;
}
afterEach(() => {fixture?.destroy();fixture=undefined;TestBed.resetTestingModule();});
describe('Daily canvas live editor', () => {
  it('groups, moves, folds, dissolves and undoes without replacing writing or identities', () => {
    const component=mount(),canvas=component.canvas, editor=component.editor!;
    canvas.selectAll();canvas.groupTitle.set('House');canvas.group();
    const before=editor.getJSON(),group=canvas.layout().groups[0],original=canvas.cards().map(c=>({id:c.id,x:c.x,y:c.y}));
    canvas.moveGroup(group.id,64,32);
    expect(canvas.cards().map(c=>c.id)).toEqual(['one','two']);
    expect(canvas.cards()[0].x).toBe(original[0].x+64);
    expect(editor.getJSON()).toEqual(before);
    canvas.foldGroup(group.id);fixture!.detectChanges();
    expect(editor.view.dom.querySelectorAll('[data-canvas-folded="true"]')).toHaveLength(2);
    canvas.foldGroup(group.id);canvas.dissolveGroup(group.id);
    expect(canvas.layout().groups).toHaveLength(0);expect(canvas.cards().every(c=>!c.group)).toBe(true);
    canvas.undo();expect(canvas.layout().groups[0].title).toBe('House');
    expect(decodeDaily(component.raw).sourceOnly).toBe(false);
    expect(readCanvas(decodeDaily(component.raw).prefix)).toEqual(canvas.layout());
  });
  it('adds multi-paragraph writing and local checklists and retains them across view changes', () => {
    const component=mount(),editor=component.editor!;
    component.canvas.add('note');
    editor.commands.insertContent('A longer thought');editor.commands.splitBlock();editor.commands.insertContent('And another paragraph');
    component.canvas.add('task');
    const before=editor.getJSON();component.canvas.setActive(false);component.canvas.setActive(true);
    expect(component.editor).toBe(editor);expect(editor.getJSON()).toEqual(before);
    expect(decodeDaily(component.raw).sourceOnly).toBe(false);
    expect(component.raw).toContain('> A longer thought');expect(component.raw).toContain('And another paragraph');expect(component.raw).toContain('New action item');
  });
  it('preserves user placements and typing while automatic source cards arrive', () => {
    const component=mount(),canvas=component.canvas,editor=component.editor!;
    canvas.choose('one');canvas.move(['one'],64,32);const placement={...canvas.cards()[0]};
    editor.commands.setTextSelection(4);editor.commands.insertContent('USER');
    const selection=editor.state.selection.from;
    const ok=component.applyAutomaticProposal({documentID:'daily',groups:[{headingID:'heading',title:'Action items',createHeading:true,blocks:[{blockID:'arrival',markdown:'<!-- maple:block {"v":1,"id":"arrival"} -->\n```maple-ref\n{"v":1,"kind":"email","eventID":"fixture-email","label":"Synthetic fixture"}\n```\n'}]}],removals:[]});
    expect(ok).toBe(true);expect(canvas.cards().find(c=>c.id==='one')?.x).toBe(placement.x);
    expect(canvas.cards().find(c=>c.id==='arrival')!.y).toBeGreaterThan(placement.y+placement.height);
    expect(editor.state.selection.from).toBe(selection);expect(editor.getText()).toContain('USER');
    expect(component.raw).toContain('mapleCanvas:');
  });
  it('selection requests are unsubmitted durable drafts with stable context IDs', () => {
    const component=mount(),submitted=vi.fn();component.submitted.subscribe(submitted);
    component.canvas.selectAll();component.askCanvasSelection();
    expect(submitted).not.toHaveBeenCalled();
    const request=decodeDaily(component.raw).doc.content!.at(-1)!;
    expect((request.attrs!['maple'] as { contextBlockIDs: string[] }).contextBlockIDs).toEqual(['one','two']);
    component.submitAt(component.canvas.cards().at(-1)!.pos);
    expect(submitted).toHaveBeenCalledOnce();
    expect(decodeDaily(component.raw).sourceOnly).toBe(false);
  });
  it('preserves Note folding without hiding or mislabeling cards in Canvas', () => {
    const component=mount('<!-- maple:block {"v":1,"id":"heading"} -->\n## A section\n\n<!-- maple:block {"v":1,"id":"writing"} -->\nWriting under the heading.\n');
    const editor=component.editor!,before=editor.getJSON();
    expect(editor.view.dom.querySelector('.maple-section-toggle')).toBeNull();
    component.canvas.setActive(false);
    (editor.view.dom.querySelector('.maple-section-toggle') as HTMLButtonElement).click();
    expect(editor.view.dom.querySelector('.maple-section-hidden')?.getAttribute('aria-hidden')).toBe('true');
    component.canvas.setActive(true);
    expect(editor.view.dom.querySelector('.maple-section-hidden')).toBeNull();
    expect(editor.view.dom.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(editor.getJSON()).toEqual(before);
    component.canvas.setActive(false);
    expect(editor.view.dom.querySelector('.maple-section-hidden')).not.toBeNull();
  });
  it('blocks mutation in read-only and raw modes and preserves unsupported layout', () => {
    const component=mount(),before=component.raw;
    fixture!.componentRef.setInput('readOnly',true);fixture!.detectChanges();
    component.canvas.selectAll();component.canvas.group();component.canvas.move(['one'],64,0);component.canvas.add('sticky');expect(component.raw).toBe(before);
    fixture!.componentRef.setInput('readOnly',false);fixture!.detectChanges();component.toggleSource();
    component.canvas.move(['one'],64,0);expect(component.raw).toBe(before);
  });
  it('persists directed links, preserves prose on undo and explores a focused graph',()=>{
    const component=mount(),canvas=component.canvas,before=component.editor!.getJSON();
    canvas.choose('one');canvas.choose('two',true);canvas.connectionLabel.set('Supports');canvas.connect();
    expect(canvas.layout().connections?.[0].label).toBe('Supports');
    expect(canvas.graphCards().map(c=>c.id)).toEqual(['one','two']);
    expect(readCanvas(decodeDaily(component.raw).prefix).connections).toEqual(canvas.layout().connections);
    canvas.connect();expect(canvas.layout().connections).toHaveLength(1);
    canvas.focus('two');expect(component.editor!.getJSON()).toEqual(before);
    expect(component.editor!.view.dom.querySelector('[data-canvas-id="one"]')?.getAttribute('style')).toContain('display: none');
    canvas.focus(null);canvas.removeConnection(canvas.layout().connections![0].id);canvas.undo();
    expect(canvas.layout().connections).toHaveLength(1);expect(component.editor!.getJSON()).toEqual(before);
  });

});

describe('Canvas pointer cancellation',()=>{
 it('restores DOM geometry when a smooth drag is canceled',()=>{
  const component=mount(),canvas=component.canvas,card=canvas.cards()[0];fixture!.detectChanges();
  const handle=fixture!.nativeElement.querySelector('[aria-label="Move card: First thought."]');
  handle.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:100,clientY:100}));
  window.dispatchEvent(new MouseEvent('pointermove',{clientX:137,clientY:121}));
  const dom=component.editor!.view.nodeDOM(card.pos) as HTMLElement;
  expect(parseFloat(dom.style.left)).toBe(card.x+37);
  window.dispatchEvent(new MouseEvent('pointercancel'));
  expect(parseFloat(dom.style.left)).toBe(card.x);expect(canvas.cards()[0].x).toBe(card.x);
 });
 it('rectangle selection includes intersecting cards without mutating Markdown',()=>{
  const component=mount(),before=component.raw,card=component.canvas.cards()[0];
  component.canvas.selectRegion({x:card.x+10,y:card.y+10,width:30,height:30});
  expect(component.canvas.selected()).toEqual([card.id]);expect(component.raw).toBe(before);
 });
});

describe('Canvas keyboard editing boundaries',()=>{
 it('resizes without replacing content and exits editing on Escape for Space-pan',()=>{
  const component=mount(),canvas=component.canvas,before=component.editor!.getJSON(),width=canvas.cards()[0].width;
  canvas.keyResize(new KeyboardEvent('keydown',{key:'ArrowRight'}),'one');expect(canvas.cards()[0].width).toBe(width+16);expect(component.editor!.getJSON()).toEqual(before);
  component.editor!.view.focus();component.editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(document.activeElement).not.toBe(component.editor!.view.dom);
 });
});
