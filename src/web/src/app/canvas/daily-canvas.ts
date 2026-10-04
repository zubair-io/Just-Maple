import { signal, computed } from '@angular/core';
import { Editor, Extension, JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CanvasCard, CanvasColor, CanvasLayout, canvasCards, emptyCanvas, rememberPlacements, snap, validateCanvas } from './canvas-layout';

const canvasKey = new PluginKey('dailyCanvas');
/** The same live editor owns canvas and note view. No copied prose or secondary save path. */
export class DailyCanvas {
  readonly active = signal(false);
  readonly layout = signal<CanvasLayout>(emptyCanvas());
  readonly cards = signal<CanvasCard[]>([]);
  readonly selected = signal<string[]>([]);
  readonly zoom = signal(1);
  readonly selectionBox = signal<{x:number;y:number;width:number;height:number}|null>(null);
  readonly focused = signal<string | null>(null);
  readonly graphOpen = signal(false);
  readonly writingFont = signal('serif');
  readonly writingSize = signal(20);
  readonly writingExpanded = signal(false);
  wordCount() { const cards=this.cards(),card=cards.find(c=>c.id===this.focused()),doc=this.editor?.state.doc,node=card&&doc?doc.nodeAt(card.pos):doc; return node?.textBetween(0,node.content.size,' ').trim().split(/\s+/).filter(Boolean).length ?? 0; }
  openGraph() { if(!this.selected().length && this.cards().length) this.choose(this.cards()[0].id); this.graphOpen.update(v=>!v); }
  readonly connectionLabel = signal('');
  readonly selectedConnection = signal<string | null>(null);
  readonly groupTitle = signal('');
  readonly message = signal('');
  readonly undoAvailable = signal(false);
  readonly redoAvailable = signal(false);
  readonly width = computed(() => Math.max(1152, ...this.cards().map(c => c.x + c.width + 64), ...this.layout().groups.map(g => g.x + g.width + 64)));
  readonly height = computed(() => Math.max(760, ...this.cards().map(c => c.y + c.height + 64), ...this.layout().groups.map(g => g.y + g.height + 64)));
  private editor?: Editor;
  private past: CanvasLayout[] = [];
  private future: CanvasLayout[] = [];
  private dragCleanup?: () => void;
  constructor(private readonly persist: (layout: CanvasLayout) => void, private readonly allowed: () => boolean = () => true) {}
  load(layout: CanvasLayout) { this.layout.set(layout); this.past = []; this.future = []; this.updateHistory(); }
  attach(editor: Editor) { this.editor = editor; this.refresh(editor.state.doc); }
  destroy() { this.dragCleanup?.(); this.editor = undefined; }
  get editable() { return this.allowed() && !!this.editor?.isEditable && !this.editor.isDestroyed && !this.editor.view.composing; }
  setActive(active: boolean) { this.focused.set(null); this.graphOpen.set(false); this.active.set(active); this.redraw(); }
  refresh(doc: PMNode) {
    this.cards.set(canvasCards(doc, this.layout()));
    const ids = new Set(this.cards().map(c => c.id));
    this.selected.update(selected => selected.filter(id => ids.has(id)));
    if (this.focused() && !ids.has(this.focused()!)) this.focused.set(null);
  }
  private redraw() {
    if (this.editor && !this.editor.isDestroyed) { this.refresh(this.editor.state.doc); this.editor.view.dispatch(this.editor.state.tr.setMeta(canvasKey, true).setMeta('addToHistory', false)); }
  }
  private updateHistory() { this.undoAvailable.set(!!this.past.length); this.redoAvailable.set(!!this.future.length); }
  private commit(layout: CanvasLayout, history = true) {
    if (!this.editable) return false;
    try {
      layout = validateCanvas(layout);
      this.persist(layout); // Validation/size errors must not adopt a layout that cannot be saved.
      if (history) { this.past.push(structuredClone(this.layout())); this.past = this.past.slice(-40); this.future = []; }
      this.layout.set(layout); this.message.set(''); this.updateHistory(); this.redraw(); return true;
    } catch (error) { this.message.set(error instanceof Error ? error.message : 'Could not save the layout.'); return false; }
  }
  undo() { const layout = this.past.at(-1), current = this.layout(); if (!layout || !this.editable) return; if (this.commit(layout, false)) { this.future.push(current); this.past.pop(); this.updateHistory(); } }
  redo() { const layout = this.future.at(-1), current = this.layout(); if (!layout || !this.editable) return; if (this.commit(layout, false)) { this.past.push(current); this.future.pop(); this.updateHistory(); } }
  choose(id: string, additive = false) {
    this.selected.update(ids => additive ? ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] : [id]);
    this.redraw();
  }
  focus(id: string | null) {
    this.focused.set(id); this.graphOpen.set(false); this.active.set(true); this.redraw();
    if (id && this.editor) { const card=this.cards().find(c=>c.id===id); if(card) this.editor.commands.setTextSelection(card.pos+(card.type==='blockquote'?2:card.type==='taskList'?3:1)); }
  }
  connect() {
    const [from,to] = this.selected();
    if (this.selected().length !== 2) { this.message.set('Select two cards to connect.'); return; }
    const layout = rememberPlacements(this.layout(),this.cards());
    const existing = layout.connections?.find(link=>link.from===from && link.to===to);
    if (existing) { this.selectedConnection.set(existing.id); this.message.set('These cards are already connected. Edit the link below.'); return; }
    const link = { id:crypto.randomUUID(),from,to,label:this.connectionLabel().trim().slice(0,120) };
    layout.connections = [...(layout.connections??[]),link];
    if(this.commit(layout)) { this.selectedConnection.set(link.id); this.connectionLabel.set(''); }
  }
  editConnection(id: string,label: string) { const layout=structuredClone(this.layout()),link=layout.connections?.find(l=>l.id===id); if(link){link.label=label.trim().slice(0,120);this.commit(layout);} }
  removeConnection(id: string) { const layout=structuredClone(this.layout()); layout.connections=(layout.connections??[]).filter(l=>l.id!==id); if(this.commit(layout)) this.selectedConnection.set(null); }
  visibleConnections() {
    const visible=new Set(this.cards().filter(c=>!this.isFolded(c)).map(c=>c.id));
    return (this.layout().connections??[]).filter(l=>visible.has(l.from)&&visible.has(l.to));
  }
  connectionGeometry(from: string,to: string) {
    const a=this.cards().find(c=>c.id===from),b=this.cards().find(c=>c.id===to);
    if(!a||!b) return {path:'',x:0,y:0};
    const right=b.x+b.width/2>=a.x+a.width/2;
    const x1=right?a.x+a.width:a.x,y1=a.y+a.height/2,x2=right?b.x:b.x+b.width,y2=b.y+b.height/2;
    const bend=Math.max(60,Math.abs(x2-x1)/2),sign=right?1:-1;
    return {path:`M ${x1} ${y1} C ${x1+sign*bend} ${y1}, ${x2-sign*bend} ${y2}, ${x2} ${y2}`,x:(x1+x2)/2,y:(y1+y2)/2};
  }
  graphCards() {
    const root=this.selected()[0];
    if(!root) return [];
    const ids=new Set([root]);
    for(let depth=0;depth<2;depth++) {
      const prior=new Set(ids);
      for(const link of this.layout().connections??[]) if(prior.has(link.from)||prior.has(link.to)){ids.add(link.from);ids.add(link.to);}
    }
    return [...this.cards().filter(c=>c.id===root),...this.cards().filter(c=>c.id!==root&&ids.has(c.id))].slice(0,40);
  }
  selectRegion(box:{x:number;y:number;width:number;height:number},additive=false) {
    const ids=this.cards().filter(c=>!this.isFolded(c)&&c.x<box.x+box.width&&c.x+c.width>box.x&&c.y<box.y+box.height&&c.y+c.height>box.y).map(c=>c.id);
    this.selected.set([...new Set([...(additive?this.selected():[]),...ids])]);this.redraw();
  }
  selectAll() { this.selected.set(this.cards().map(c => c.id)); this.redraw(); }
  selectNone() { this.selected.set([]); this.redraw(); }
  move(ids: string[], dx: number, dy: number) {
    const layout = rememberPlacements(this.layout(), this.cards());
    const selected = layout.cards.filter(c => ids.includes(c.id));
    if (!selected.length) return;
    dx = Math.max(-Math.min(...selected.map(c => c.x)), Math.min(100000 - Math.max(...selected.map(c => c.x)), dx));
    dy = Math.max(-Math.min(...selected.map(c => c.y)), Math.min(100000 - Math.max(...selected.map(c => c.y)), dy));
    for (const card of selected) { card.x = snap(card.x + dx); card.y = snap(card.y + dy); }
    for (const card of selected) if (card.group) {
      const group = layout.groups.find(g => g.id === card.group)!;
      const inside = card.x >= group.x && card.y >= group.y + 48 && card.x + card.width <= group.x + group.width && card.y + card.height <= group.y + group.height;
      if (!inside) delete card.group;
    }
    this.commit(layout);
  }
  keyMove(event: KeyboardEvent, id: string, group = false) {
    const vectors: Record<string, [number, number]> = { ArrowLeft: [-16,0], ArrowRight: [16,0], ArrowUp: [0,-16], ArrowDown: [0,16] };
    const vector = vectors[event.key];
    if (!vector || !this.editable) return;
    event.preventDefault(); event.stopPropagation();
    const factor = event.shiftKey ? 4 : 1;
    if (group) this.moveGroup(id, vector[0] * factor, vector[1] * factor);
    else this.move(this.selected().includes(id) ? this.selected() : [id], vector[0] * factor, vector[1] * factor);
  }
  drag(event: PointerEvent, id: string, group = false) {
    if (!this.editable || event.button !== 0 || event.shiftKey) return;
    event.preventDefault();
    if (!group && !this.selected().includes(id)) this.choose(id);
    const target = event.currentTarget as HTMLElement, x = event.clientX, y = event.clientY;
    let dx = 0, dy = 0;
    const base = this.layout();
    const all = rememberPlacements(base, this.cards());
    const ids = group ? all.cards.filter(c => c.group === id).map(c => c.id) : this.selected();
    const startCards = this.cards();
    const update = (e: PointerEvent) => {
      dx = (e.clientX - x) / this.zoom(); dy = (e.clientY - y) / this.zoom();
      const selected = startCards.filter(c => ids.includes(c.id));
      const frame = group ? base.groups.find(g => g.id === id) : undefined;
      const xs = [...selected.map(c => c.x), ...(frame ? [frame.x] : [])], ys = [...selected.map(c => c.y), ...(frame ? [frame.y] : [])];
      if (xs.length) dx = Math.max(-Math.min(...xs), Math.min(100000-Math.max(...xs), dx));
      if (ys.length) dy = Math.max(-Math.min(...ys), Math.min(100000-Math.max(...ys), dy));
      this.cards.set(startCards.map(c => ids.includes(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c));
      this.layout.set({ ...base, cards: all.cards.map(c => ids.includes(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c), groups: base.groups.map(g => frame && g.id === id ? { ...g, x: g.x + dx, y: g.y + dy } : g) });
      if (this.editor) for (const card of this.cards().filter(c=>ids.includes(c.id))) {
        const dom=this.editor.view.nodeDOM(card.pos) as HTMLElement|null;
        if(dom) {dom.style.left=card.x+'px';dom.style.top=(card.y+36)+'px';}
      }
      
    };
    const end = (e: PointerEvent) => {
      cleanup(); this.layout.set(base); this.cards.set(startCards);
      if(this.editor)for(const card of startCards.filter(c=>ids.includes(c.id))){const dom=this.editor.view.nodeDOM(card.pos) as HTMLElement|null;if(dom){dom.style.left=card.x+'px';dom.style.top=(card.y+36)+'px';}}
      if (e.type === 'pointercancel') { this.redraw(); return; }
      if (dx || dy) { if (group) this.moveGroup(id, dx, dy); else this.move(ids, dx, dy); }
      else this.redraw();
    };
    const cleanup = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); this.dragCleanup = undefined; target.releasePointerCapture?.(event.pointerId); };
    this.dragCleanup?.(); this.dragCleanup = cleanup;
    target.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', update); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  keyResize(event:KeyboardEvent,id:string) {
    const vectors:Record<string,[number,number]>={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]},vector=vectors[event.key];
    if(!vector||!this.editable)return;
    event.preventDefault();event.stopPropagation();const layout=rememberPlacements(this.layout(),this.cards()),card=layout.cards.find(c=>c.id===id);if(!card)return;
    const factor=event.shiftKey?4:1;card.width=Math.max(160,Math.min(4000,card.width+vector[0]*factor));card.height=Math.max(160,Math.min(4000,card.height+vector[1]*factor));
    if(card.group){const group=layout.groups.find(g=>g.id===card.group)!;if(card.x+card.width>group.x+group.width||card.y+card.height>group.y+group.height)delete card.group;}
    this.commit(layout);
  }
  resizeCard(event:PointerEvent,id:string) {
    if(!this.editable||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const card=this.cards().find(c=>c.id===id);if(!card)return;
    const target=event.currentTarget as HTMLElement,x=event.clientX,y=event.clientY;
    const base=this.layout(),original=this.cards();let width=card.width,height=card.height;
    const update=(e:PointerEvent)=>{
      width=Math.max(160,Math.min(4000,card.width+(e.clientX-x)/this.zoom()));
      height=Math.max(160,Math.min(4000,card.height+(e.clientY-y)/this.zoom()));
      this.cards.set(original.map(c=>c.id===id?{...c,width,height}:c));
      const dom=this.editor?.view.nodeDOM(card.pos) as HTMLElement|null;
      if(dom){dom.style.width=width+'px';dom.style.height=(height-36)+'px';}
    };
    const cleanup=()=>{window.removeEventListener('pointermove',update);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);this.dragCleanup=undefined;if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);};
    const end=(e:PointerEvent)=>{
      cleanup();this.cards.set(original);
      const dom=this.editor?.view.nodeDOM(card.pos) as HTMLElement|null;if(dom){dom.style.width=card.width+'px';dom.style.height=(card.height-36)+'px';}
      if(e.type==='pointercancel'){this.redraw();return;}
      const layout=rememberPlacements(base,original),saved=layout.cards.find(c=>c.id===id)!;
      saved.width=Math.max(160,Math.round(width/16)*16);saved.height=Math.max(160,Math.round(height/16)*16);
      if(saved.group){const group=layout.groups.find(g=>g.id===saved.group)!;if(saved.x+saved.width>group.x+group.width||saved.y+saved.height>group.y+group.height)delete saved.group;}
      if(!this.commit(layout))this.redraw();
    };
    this.dragCleanup?.();this.dragCleanup=cleanup;target.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove',update);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  }
  moveGroup(id: string, dx: number, dy: number) {
    const layout = rememberPlacements(this.layout(), this.cards()), group = layout.groups.find(g => g.id === id);
    if (!group) return;
    const members = layout.cards.filter(c => c.group === id);
    const xs = [group.x, ...members.map(c => c.x)], ys = [group.y, ...members.map(c => c.y)];
    dx = Math.max(-Math.min(...xs), Math.min(100000 - Math.max(...xs), dx));
    dy = Math.max(-Math.min(...ys), Math.min(100000 - Math.max(...ys), dy));
    group.x = snap(group.x + dx); group.y = snap(group.y + dy);
    for (const card of members) { card.x = snap(card.x + dx); card.y = snap(card.y + dy); }
    this.commit(layout);
  }
  group() {
    if (!this.selected().length) return;
    const layout = rememberPlacements(this.layout(), this.cards());
    const cards = layout.cards.filter(c => this.selected().includes(c.id)), id = crypto.randomUUID();
    const x = Math.max(0, Math.min(...cards.map(c => c.x)) - 16), y = Math.max(0, Math.min(...cards.map(c => c.y)) - 64);
    const columns = Math.min(3, cards.length), width = Math.max(...cards.map(c => c.width));
    const height = Math.max(...cards.map(c => c.height));
    const groupWidth = columns * (width + 24) + 8, groupHeight = Math.ceil(cards.length / columns) * (height + 24) + 64;
    if (groupWidth > 4000 || groupHeight > 4000) { this.message.set('Select fewer cards to fit in one group.'); return; }
    cards.forEach((card, i) => { card.group = id; card.x = x + 16 + (i % columns) * (width + 24); card.y = y + 64 + Math.floor(i / columns) * (height + 24); });
    layout.groups.push({ id, title: this.groupTitle().trim().slice(0,120) || 'Related work', x, y, width: groupWidth, height: groupHeight, folded: false });
    this.commit(layout); this.groupTitle.set('');
  }
  renameGroup(id: string, title: string) { const layout = structuredClone(this.layout()); const group = layout.groups.find(g => g.id === id); if (group) { group.title = title.trim().slice(0,120) || 'Related work'; this.commit(layout); } }
  foldGroup(id: string) {
    const layout = structuredClone(this.layout()), group = layout.groups.find(g => g.id === id);
    if (!group) return;
    group.folded = !group.folded;
    if (group.folded && this.editor) {
      const selected = this.editor.state.selection.from;
      const member = this.cards().find(c => c.group === id && c.pos <= selected && c.pos + c.size > selected);
      if (member) this.editor.view.dom.blur();
      this.selected.update(ids => ids.filter(cardID => !this.cards().some(c => c.id === cardID && c.group === id)));
    }
    this.commit(layout);
  }
  dissolveGroup(id: string) { const layout = structuredClone(this.layout()); layout.groups = layout.groups.filter(g => g.id !== id); for (const card of layout.cards) if (card.group === id) delete card.group; this.commit(layout); }
  ungroup() { const layout = rememberPlacements(this.layout(), this.cards()); for (const card of layout.cards) if (this.selected().includes(card.id)) delete card.group; this.commit(layout); }
  color(color: CanvasColor) { const layout = rememberPlacements(this.layout(), this.cards()); for (const card of layout.cards) if (this.selected().includes(card.id)) card.color = color; this.commit(layout); }
  resize(width: number) { const layout = rememberPlacements(this.layout(), this.cards()); for (const card of layout.cards) if (this.selected().includes(card.id)) { card.width = width; card.height = width === 640 ? 432 : 272; delete card.group; } this.commit(layout); }
  arrange() {
    const layout = rememberPlacements(this.layout(), this.cards());
    const ids = this.selected().length ? this.selected() : this.cards().map(c => c.id);
    const cards = layout.cards.filter(c => ids.includes(c.id));
    const width = Math.max(320,...cards.map(c => c.width)), height = Math.max(272,...cards.map(c => c.height));
    // Keep unselected work in place and arrange the selection on a new shelf.
    const other = layout.cards.filter(c => !ids.includes(c.id));
    const y = Math.max(32,...other.map(c => c.y + c.height + 64),...layout.groups.map(g => g.y + g.height + 64));
    cards.forEach((card,i) => { card.x = 32 + (i % 3) * (width + 32); card.y = y + Math.floor(i / 3) * (height + 64); delete card.group; });
    this.commit(layout);
  }
  add(kind: 'sticky' | 'note' | 'task' | 'maple') {
    if (!this.editable || !this.editor) return;
    const id = crypto.randomUUID(), attrs = { maple: { v: 1, id } };
    let node: JSONContent;
    if (kind === 'note') node = { type: 'blockquote', attrs, content: [{ type: 'paragraph' }] };
    else if (kind === 'task') node = { type: 'taskList', attrs, content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New action item' }] }] }] };
    else node = { type: 'paragraph', attrs, ...(kind === 'maple' ? { content: [{ type: 'text', text: '@maple ' }] } : {}) };
    // Capture the current positions before inserting, so the next arrival cannot shuffle existing cards.
    const layout = rememberPlacements(this.layout(), this.cards());
    const width = kind === 'note' ? 640 : 320, height = kind === 'note' ? 432 : 272;
    const obstacles = [...layout.cards, ...layout.groups];
    let x = 32, y = 32, found = false;
    for (let row = 0; row < 300 && !found; row++) for (let column = 0; column < 3 && !found; column++) {
      x = 32 + column * 352; y = 32 + row * 336;
      found = !obstacles.some(item => x < item.x + item.width + 16 && x + width + 16 > item.x && y < item.y + item.height + 32 && y + height + 32 > item.y);
    }
    if (!found || layout.cards.length >= 1024) { this.message.set('This canvas is at its card limit. Continue in Note view or another day.'); return; }
    layout.cards.push({ id, x, y, width, height, color: kind === 'sticky' ? 'yellow' : 'paper' });
    if (!this.commit(layout)) return;
    const pos = this.editor.state.doc.content.size;
    this.editor.commands.insertContentAt(pos, node);
    this.choose(id);
    this.editor.commands.setTextSelection(pos + (kind === 'task' ? 3 : kind === 'note' ? 2 : 1));
    this.editor.view.focus();
    requestAnimationFrame(() => (this.editor?.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  isFolded(card: CanvasCard) { return this.layout().groups.some(g => g.id === card.group && g.folded); }
  decorations(doc: PMNode) {
    if (!this.active()) return DecorationSet.empty;
    const cards = canvasCards(doc, this.layout());
    return DecorationSet.create(doc, cards.map(card => Decoration.node(card.pos, card.pos + card.size, {
      class: `maple-canvas-card canvas-color-${card.color}${this.selected().includes(card.id) ? ' canvas-selected' : ''}`,
      style: this.focused() === card.id ? 'left:0;top:36px;width:100%;min-height:640px;height:auto;' : `left:${card.x}px;top:${card.y + 36}px;width:${card.width}px;height:${card.height - 36}px;${this.isFolded(card) || (this.focused() && this.focused() !== card.id) ? 'display:none;' : ''}`,
      'data-canvas-id': card.id,
      'data-canvas-folded': String(this.isFolded(card)),
    })));
  }
  extension() {
    const owner = this;
    return Extension.create({ name: 'dailyCanvas', addProseMirrorPlugins() { return [new Plugin({
      key: canvasKey,
      state: { init: (_, state) => owner.decorations(state.doc), apply: (tr, previous, _, state) => tr.docChanged || tr.getMeta(canvasKey) ? owner.decorations(state.doc) : previous },
      props: { decorations: state => canvasKey.getState(state), handleKeyDown: (_, event) => {
        if (owner.active() && event.key === 'Escape') { owner.selectNone(); if(owner.focused())owner.focus(null); owner.editor?.view.dom.blur(); return true; } return false;
      } },
    })]; } });
  }
}

