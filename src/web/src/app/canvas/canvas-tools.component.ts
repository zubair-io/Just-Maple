import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MuiButtonComponent } from '@maple/ui';
import { DailyCanvas } from './daily-canvas';
import { CanvasColor } from './canvas-layout';
@Component({
  selector: 'maple-canvas-tools', standalone: true, imports: [FormsModule, MuiButtonComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (!overlay()) {
    <div class="canvas-floating-header" role="toolbar" aria-label="Daily canvas tools">
    <div class="canvas-toolbar">
      @if (dayLabel()) { <time class="canvas-day date-chip" [attr.datetime]="dayDate()" [attr.title]="dayTitle()" [attr.aria-label]="dayTitle()">{{dayLabel()}}</time> }
      <div class="canvas-view-switch" role="group" aria-label="Today view">
        <button type="button" [attr.aria-pressed]="canvas().active()" (click)="canvas().setActive(true)">Canvas</button>
        <button type="button" [attr.aria-pressed]="!canvas().active()" (click)="canvas().setActive(false)">Note</button>
      </div>
      <button type="button" [attr.aria-pressed]="canvas().graphOpen()" (click)="canvas().openGraph()">Connections</button>
      @if (!canvas().active() || canvas().focused()) {
        <select aria-label="Writing typeface" [ngModel]="canvas().writingFont()" (ngModelChange)="canvas().writingFont.set($event)"><option value="serif">Serif</option><option value="sans">Sans</option></select>
        <select aria-label="Writing text size" [ngModel]="canvas().writingSize()" (ngModelChange)="canvas().writingSize.set(+$event)"><option [value]="18">18 px</option><option [value]="20">20 px</option><option [value]="22">22 px</option></select>
        <button type="button" [attr.aria-pressed]="canvas().writingExpanded()" (click)="canvas().writingExpanded.set(!canvas().writingExpanded())">{{canvas().writingExpanded() ? 'Readable width' : 'Expand width'}}</button>
        <span class="canvas-word-count">{{canvas().wordCount()}} words</span>
      }
      @if (canvas().focused()) { <mui-button variant="ghost" (pressed)="canvas().focus(null)">Back to canvas</mui-button> }
      @if (canvas().active() && !canvas().focused()) {
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().add('sticky')">＋ Sticky</mui-button>
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().add('task')">☑ Action</mui-button>
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().add('note')">¶ Note</mui-button>
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="sourceRequested.emit()">＋ Source</mui-button>
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().add('maple')">✦ Ask Maple</mui-button>
        <span class="canvas-toolbar-spacer"></span>
        <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().arrange()">Arrange</mui-button>
        <button type="button" aria-label="Zoom out" (click)="setZoom(-0.1)">−</button>
        <button type="button" aria-label="Reset canvas zoom" (click)="canvas().zoom.set(1)">{{ (canvas().zoom() * 100).toFixed(0) }}%</button>
        <button type="button" aria-label="Zoom in" (click)="setZoom(0.1)">＋</button>
        <mui-button variant="ghost" (pressed)="fitRequested.emit()">Fit</mui-button>
        <mui-button variant="ghost" ariaLabel="Canvas document tools" (pressed)="toolsRequested.emit()">⋯</mui-button>
      }
    @if (canvas().active() && !canvas().focused()) {
      <details class="canvas-selection-menu" [open]="canvas().selected().length > 0">
        <summary>{{ canvas().selected().length ? canvas().selected().length + " selected" : "Select & group" }}</summary>
      <div class="canvas-selection-tools" aria-label="Selected cards">
        <button type="button" (click)="canvas().selectAll()">Select all</button>
        @if (canvas().selected().length) {
          <span>{{ canvas().selected().length }} selected</span>
          @if (canvas().selected().length === 1) { <button type="button" (click)="canvas().focus(canvas().selected()[0])">Focus writing</button> }
          @if (canvas().selected().length === 2) {
            <input aria-label="Connection label" maxlength="120" placeholder="Relationship…" [ngModel]="canvas().connectionLabel()" (ngModelChange)="canvas().connectionLabel.set($event)" />
            <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().connect()">Connect cards</mui-button>
          }
          <input aria-label="Group name" placeholder="Name this group…" maxlength="120" [disabled]="readOnly()" [ngModel]="canvas().groupTitle()" (ngModelChange)="canvas().groupTitle.set($event)" (keydown.enter)="canvas().group()" />
          <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="canvas().group()">Box together</mui-button>
          <button type="button" [disabled]="readOnly()" (click)="canvas().ungroup()">Ungroup</button>
          <select aria-label="Selected card color" [value]="selectedColor()" [disabled]="readOnly()" (change)="color($event)"><option value="" disabled>Mixed colors</option><option value="paper">Paper</option><option value="yellow">Yellow</option><option value="green">Green</option><option value="rose">Rose</option></select>
          <select aria-label="Selected card size" [value]="selectedSize()" [disabled]="readOnly()" (change)="size($event)"><option value="" disabled>Mixed sizes</option><option value="320">Compact</option><option value="640">Writing size</option></select>
          <mui-button variant="ghost" [disabled]="readOnly()" (pressed)="askSelection.emit()">Ask about selection</mui-button>
          <button type="button" (click)="canvas().selectNone()">Deselect</button>
        }
        <span class="canvas-toolbar-spacer"></span>
        <button type="button" aria-label="Undo layout change" [disabled]="readOnly() || !canvas().undoAvailable()" (click)="canvas().undo()">↶ Layout</button>
        <button type="button" aria-label="Redo layout change" [disabled]="readOnly() || !canvas().redoAvailable()" (click)="canvas().redo()">↷</button>
      </div>
      </details>
      @if (canvas().selectedConnection(); as id) {
        @for (link of canvas().layout().connections ?? []; track link.id) { @if (link.id === id) {
          <div class="canvas-link-editor" aria-label="Edit connection">
            <label>Connection <input aria-label="Rename connection" maxlength="120" [value]="link.label" [disabled]="readOnly()" (change)="canvas().editConnection(id,$any($event.target).value)" /></label>
            <button type="button" [disabled]="readOnly()" (click)="canvas().removeConnection(id)">Remove connection</button>
            <button type="button" (click)="canvas().selectedConnection.set(null)">Done</button>
          </div>
        } }
      }
      @if (canvas().message()) { <p class="maple-editor-notice" role="status">{{ canvas().message() }}</p> }
    }
    </div>
    </div>
  } @else {
    @if (!canvas().focused()) {
      @if(canvas().selectionBox();as box){<div class="canvas-marquee" [style.left.px]="box.x" [style.top.px]="box.y" [style.width.px]="box.width" [style.height.px]="box.height"></div>}
      <svg class="canvas-connections" [attr.width]="canvas().width()" [attr.height]="canvas().height()" aria-label="Card connections">
        <defs><marker id="maple-connection-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
        @for (link of canvas().visibleConnections(); track link.id) {
          <g [class.selected]="canvas().selectedConnection() === link.id">
            <path class="canvas-connection-line" [attr.d]="canvas().connectionGeometry(link.from,link.to).path" marker-end="url(#maple-connection-arrow)" />
            <path class="canvas-connection-hit" [attr.d]="canvas().connectionGeometry(link.from,link.to).path" tabindex="0" role="button" [attr.aria-label]="'Edit connection: ' + (link.label || 'Related')" (click)="canvas().selectedConnection.set(link.id)" (keydown.enter)="canvas().selectedConnection.set(link.id)" />
            <text [attr.x]="canvas().connectionGeometry(link.from,link.to).x" [attr.y]="canvas().connectionGeometry(link.from,link.to).y - 12">{{link.label}}</text>
          </g>
        }
      </svg>
    @for (group of canvas().layout().groups; track group.id) {
      <section class="canvas-group" [class.folded]="group.folded" [style.left.px]="group.x" [style.top.px]="group.y" [style.width.px]="group.width" [style.height.px]="group.folded ? 52 : group.height" [attr.aria-label]="group.title">
        <header>
          <button type="button" class="canvas-move" [disabled]="readOnly()" [attr.aria-label]="'Move group: ' + group.title" (pointerdown)="canvas().drag($event, group.id, true)" (keydown)="canvas().keyMove($event, group.id, true)">⠿</button>
          <input [attr.aria-label]="'Rename group: ' + group.title" [value]="group.title" [disabled]="readOnly()" maxlength="120" (change)="rename(group.id, $event)" />
          <button type="button" [disabled]="readOnly()" [attr.aria-expanded]="!group.folded" [attr.aria-label]="(group.folded ? 'Expand ' : 'Collapse ') + group.title" (click)="canvas().foldGroup(group.id)">{{ group.folded ? '▸' : '▾' }}</button>
          <button type="button" [disabled]="readOnly()" [attr.aria-label]="'Remove box, keep cards: ' + group.title" (click)="canvas().dissolveGroup(group.id)">×</button>
        </header>
      </section>
    }
    @for (card of canvas().cards(); track card.id) {
      @if (!canvas().isFolded(card)) {
        <button type="button" class="canvas-resize" [disabled]="readOnly()" [style.left.px]="card.x + card.width - 20" [style.top.px]="card.y + card.height - 20" [attr.aria-label]="'Resize card: ' + card.label" (pointerdown)="canvas().resizeCard($event,card.id)" (keydown)="canvas().keyResize($event,card.id)">◢</button>
        <div class="canvas-card-header" [class.selected]="canvas().selected().includes(card.id)" [style.left.px]="card.x" [style.top.px]="card.y" [style.width.px]="card.width">
          <button type="button" class="canvas-card-select" [attr.aria-label]="'Select card: ' + card.label" [attr.aria-pressed]="canvas().selected().includes(card.id)" (click)="canvas().choose(card.id, true)">{{ canvas().selected().includes(card.id) ? '●' : '○' }}</button>
          <button type="button" class="canvas-move canvas-card-title" [attr.aria-label]="'Move card: ' + card.label" [disabled]="readOnly()" (pointerdown)="canvas().drag($event, card.id)" (click)="$event.shiftKey && canvas().choose(card.id, true)" (keydown)="canvas().keyMove($event, card.id)">{{ kindLabel(card.type) }}</button>
          <details class="canvas-card-menu" (pointerdown)="$event.stopPropagation()">
            <summary [attr.aria-label]="'Actions for card: ' + card.label">⋯</summary>
            <div class="canvas-card-menu-items">
              <button type="button" [disabled]="readOnly()" (click)="cardAction.emit({blockID:card.id,kind:'done'});closeMenu($event)">{{card.taskID || card.type === 'taskList' ? 'Complete & hide' : 'Done · hide from board'}}</button>
              <button type="button" [disabled]="readOnly()" (click)="cardAction.emit({blockID:card.id,kind:'hide'});closeMenu($event)">Hide without completing</button>
              @if(card.eventID){
                <button type="button" [disabled]="readOnly()" (click)="cardAction.emit({blockID:card.id,kind:'exclude',eventID:card.eventID,scope:'github'});closeMenu($event)">Ignore GitHub notifications</button>
                <button type="button" [disabled]="readOnly()" (click)="cardAction.emit({blockID:card.id,kind:'exclude',eventID:card.eventID,scope:'sender'});closeMenu($event)">Ignore messages from this sender</button>
                <button type="button" [disabled]="readOnly()" (click)="cardAction.emit({blockID:card.id,kind:'exclude',eventID:card.eventID,scope:'type'});closeMenu($event)">Ignore all messages of this source type</button>
              }
            </div>
          </details>
          <button type="button" [attr.aria-label]="'Focus card: ' + card.label" (click)="canvas().focus(card.id)">↗</button>
        </div>
      }
    }
    }
  }`,
})
export class CanvasToolsComponent {
  readonly canvas = input.required<DailyCanvas>();
  readonly overlay = input(false);
  readonly dayLabel = input("");
  readonly dayTitle = input("");
  readonly dayDate = input("");
  readonly readOnly = input(false);
  readonly sourceRequested = output<void>();
  readonly toolsRequested = output<void>();
  readonly fitRequested = output<void>();
  readonly askSelection = output<void>();
  readonly cardAction = output<{blockID:string;kind:'done'|'hide'|'exclude';eventID?:string;scope?:string}>();
  closeMenu(event:Event){(event.target as HTMLElement).closest('details')?.removeAttribute('open');}
  selectedColor() { const values = new Set(this.canvas().cards().filter(card => this.canvas().selected().includes(card.id)).map(card => card.color)); return values.size === 1 ? [...values][0] : ''; }
  selectedSize() { const values = new Set(this.canvas().cards().filter(card => this.canvas().selected().includes(card.id)).map(card => String(card.width))); return values.size === 1 ? [...values][0] : ''; }
  setZoom(delta: number) { this.canvas().zoom.update(value => Math.max(0.2, Math.min(2.5, Math.round((value + delta) * 100) / 100))); }
  color(event: Event) { this.canvas().color((event.target as HTMLSelectElement).value as CanvasColor); }
  size(event: Event) { this.canvas().resize(Number((event.target as HTMLSelectElement).value)); }
  rename(id: string, event: Event) { this.canvas().renameGroup(id, (event.target as HTMLInputElement).value); }
  kindLabel(type: string) { return ({ paragraph: 'Sticky', blockquote: 'Writing note', taskList: 'Action item · local checklist', linkedTask: 'Linked task', sourceReference: 'Source', 'maple-request': '✦ Maple request', 'maple-reply': '✦ Maple reply', heading: 'Section' } as Record<string,string>)[type] ?? 'Note'; }
}
