import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MuiButtonComponent, MuiCheckboxComponent } from '@maple/ui';
import { NativeBridge } from '../core/native-bridge.service';
import { companionHost, isCompanion } from '../core/companion-host';
import { SourceInspectorComponent } from '../sources/source-inspector.component';
import { SourceEvidence } from '../sources/source.models';
import { DailyNoteService } from './daily-note.service';
import { DailyBlock, DailyBlockKind, DailyHistory, localDay, offsetDay } from './daily-note.models';
@Component({ selector: 'maple-daily-note', standalone: true, imports: [FormsModule, DatePipe, MuiButtonComponent, MuiCheckboxComponent, SourceInspectorComponent], templateUrl: './daily-note.component.html', styleUrl: './daily-note.component.css', changeDetection: ChangeDetectionStrategy.OnPush })
export class DailyNoteComponent implements OnInit, OnDestroy {
  readonly notes = inject(DailyNoteService); private readonly bridge = inject(NativeBridge);
  readonly kinds: DailyBlockKind[] = ['text', 'heading', 'task', 'email', 'message', 'code'];
  readonly historyOpen = signal(false); readonly selectedHistory = signal<DailyHistory[] | null>(null); readonly historyError = signal(''); readonly historyTitle = signal('');
  readonly source = signal<SourceEvidence | null>(null); readonly sourceError = signal('');
  get composerKind() { return this.notes.composerKind; } set composerKind(value: DailyBlockKind) { this.notes.composerKind = value; }
  get composer() { return this.notes.composer; } set composer(value: string) { this.notes.composer = value; }
  private timer?: ReturnType<typeof setInterval>; private inspection = 0;
  readonly offsetDay = offsetDay;
  ngOnInit() { void this.notes.refresh(); this.timer = setInterval(() => void this.notes.refresh(), 5000); }
  ngOnDestroy() { clearInterval(this.timer); this.inspection++; }
  title() { const day = this.notes.day(), today = localDay(); return day === today ? 'Today' : day === offsetDay(today, 1) ? 'Tomorrow' : day === offsetDay(today, -1) ? 'Yesterday' : 'Daily note'; }
  date() { return new Date(`${this.notes.day()}T12:00:00`); }
  async navigate(day: string) { await this.notes.open(day); }
  async add() { if (!this.composer.trim() || this.notes.busy() || this.notes.pending()) return; const text = this.composer; if (await this.notes.create(this.composerKind, text, this.notes.composerID)) { if (this.composer === text) this.composer = ''; this.notes.composerID = crypto.randomUUID(); } }
  async inspect(block: DailyBlock) {
    this.historyOpen.set(true); this.historyTitle.set(block.source?.title || block.content.slice(0, 70)); this.selectedHistory.set(null); this.historyError.set('');
    const generation = ++this.inspection;
    try { const rows = await this.notes.history(block.id); if (generation === this.inspection) this.selectedHistory.set(rows); }
    catch (e) { if (generation === this.inspection) this.historyError.set(e instanceof Error ? e.message : 'History could not be opened.'); }
  }
  closeHistory() { this.historyOpen.set(false); this.inspection++; }
  historyContent(value?: string) { if (!value) return ''; try { const parsed = JSON.parse(value); return typeof parsed.content === 'string' ? parsed.content : value; } catch { return value; } }
  async inspectSource(block: DailyBlock) {
    if (!block.source) return; this.sourceError.set('');
    try { this.source.set(isCompanion() ? await companionHost()!.postMessage({ action: 'sourceInspect', id: block.source.eventID }) as SourceEvidence : await this.bridge.inspectSource(block.source.eventID)); }
    catch (e) { this.sourceError.set(e instanceof Error ? e.message : 'The source is unavailable.'); }
  }
}
