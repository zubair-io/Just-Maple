import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { NativeBridge } from '../core/native-bridge.service';
import { companionHost, isCompanion } from '../core/companion-host';
import { DailyBlock, DailyBlockKind, DailyBlockMutation, DailyHistory, DailyNoteSnapshot, localDay, offsetDay } from './daily-note.models';
interface Draft { content: string; version: number; day: string }
interface ComposerDraft { content: string; kind: DailyBlockKind; id: string }
@Injectable({ providedIn: 'root' })
export class DailyNoteService implements OnDestroy {
  private readonly bridge = inject(NativeBridge);
  readonly day = signal(localDay());
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly snapshot = signal<DailyNoteSnapshot | null>(null);
  readonly loading = signal(false); readonly busy = signal(false); readonly error = signal(''); readonly notice = signal('');
  readonly drafts = signal<Record<string, Draft>>(this.readDrafts());
  readonly undoBlock = signal<DailyBlock | null>(null);
  readonly pending = computed(() => !!this.snapshot()?.sync?.pending.length);
  readonly blocks = computed(() => this.snapshot()?.blocks ?? []);
  readonly recoveredDrafts = computed(() => Object.entries(this.drafts()).filter(([id]) => !this.blocks().some(block => block.id === id)).map(([id, draft]) => ({ id, ...draft })));
  private composers: Record<string, ComposerDraft> = this.readComposers();
  get composer() { return this.composers[this.day()]?.content ?? ''; }
  set composer(content: string) { this.updateComposer({content}); }
  get composerKind(): DailyBlockKind { return this.composers[this.day()]?.kind ?? 'text'; }
  set composerKind(kind: DailyBlockKind) { this.updateComposer({kind}); }
  get composerID() { if (!this.composers[this.day()]) this.updateComposer({}); return this.composers[this.day()].id; }
  set composerID(id: string) { this.updateComposer({id}); }
  private recoveryIDs = new Map<string, string>(this.readRecoveryIDs());
  private readRecoveryIDs(): [string, string][] { try { return JSON.parse(localStorage.getItem('maple.daily.recoveryIDs.v1') || '[]'); } catch { return []; } }
  private readComposers(): Record<string, ComposerDraft> {
    try { return JSON.parse(localStorage.getItem('maple.daily.composers.v1') || '{}') || {}; } catch { return {}; }
  }
  private updateComposer(change: Partial<ComposerDraft>) {
    this.composers[this.day()] = {...(this.composers[this.day()] ?? {content:'',kind:'text',id:crypto.randomUUID()}), ...change};
    try { localStorage.setItem('maple.daily.composers.v1', JSON.stringify(this.composers)); } catch { this.notice.set('Keep this page open until your new block saves.'); }
  }
  ngOnDestroy() { clearTimeout(this.timer); }
  private requestIDs = new Map<string, string>();
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private writeTail: Promise<boolean> = Promise.resolve(true);
  private request<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    if (!isCompanion()) return this.bridge.notebook<T>(action, data);
    const host = companionHost();
    return host ? host.postMessage({ action, ...data }) as Promise<T> : Promise.reject(new Error('Open Just Maple on your iPhone to access its saved daily notes.'));
  }
  private readDrafts(): Record<string, Draft> {
    try { const value = JSON.parse(localStorage.getItem('maple.daily.drafts.v1') || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
  }
  private persistDrafts() { try { localStorage.setItem('maple.daily.drafts.v1', JSON.stringify(this.drafts())); } catch { this.notice.set('Your edit is held here. Keep this page open until it saves.'); } }
  content(block: DailyBlock) { return this.drafts()[block.id]?.content ?? block.content; }
  change(block: DailyBlock, content: string) {
    const old = this.drafts()[block.id];
    this.drafts.update(d => ({ ...d, [block.id]: { content, version: old?.version ?? block.version, day: block.day } }));
    this.persistDrafts(); clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 900);
  }
  hasDraft(block: DailyBlock) { return !!this.drafts()[block.id]; }
  conflict(block: DailyBlock) { const draft = this.drafts()[block.id]; return !!draft && draft.version !== block.version; }
  async open(day: string): Promise<boolean> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !await this.flush()) return false;
    this.generation++; this.loading.set(false); this.day.set(day); this.snapshot.set(null); this.undoBlock.set(null);
    await this.refresh(); return !!this.snapshot();
  }
  async refresh() {
    if (this.busy() || this.loading()) return;
    const generation = ++this.generation, day = this.day(); this.loading.set(true);
    try {
      const next = await this.request<DailyNoteSnapshot>('dailyNote', { day, timeZone: this.timeZone });
      if (generation !== this.generation) return;
      if (!next || next.day !== day || !Array.isArray(next.blocks) || !Array.isArray(next.cleared)) throw new Error('Daily notes are unavailable. Update the native app and try again.');
      this.snapshot.set(next); this.error.set('');
      // A queued phone edit is only settled once its content returns from the Mac.
      if (!next.sync?.pending.length) {
        this.drafts.update(d => Object.fromEntries(Object.entries(d).filter(([id, draft]) => !next.blocks.some(b => b.id === id && b.content === draft.content && b.version > draft.version))));
        // Queueing is not acceptance. Settle new-block drafts only when the Mac returns their stable IDs.
        const composer = this.composers[next.day];
        const acceptedComposer = composer && next.blocks.find(block => block.id === composer.id);
        if (acceptedComposer) this.updateComposer({content: acceptedComposer.content === composer.content ? '' : composer.content, id: crypto.randomUUID()});
        for (const [draftID, copyID] of this.recoveryIDs) {
          const draft = this.drafts()[draftID];
          if (draft && next.blocks.some(block => block.id === copyID && block.content === draft.content)) this.discardDraft(draftID);
        }
        this.persistDrafts();
      }
    } catch (e) { if (generation === this.generation) this.fail(e); }
    finally { if (generation === this.generation) this.loading.set(false); }
  }
  private requestID(payload: unknown) {
    const key = JSON.stringify(payload); let id = this.requestIDs.get(key);
    if (!id) { id = crypto.randomUUID(); this.requestIDs.set(key, id); } return id;
  }
  private mutate(input: Omit<DailyBlockMutation, 'requestID' | 'timeZone'>): Promise<boolean> {
    const record: DailyBlockMutation = { ...input, timeZone: this.timeZone, requestID: this.requestID(input) };
    const job = this.writeTail.then(async () => {
      if (this.pending()) { this.notice.set('This change is waiting for your Mac. More edits can be saved after it syncs.'); return false; }
      this.busy.set(true); this.error.set(''); this.generation++; this.loading.set(false);
      try {
        const next = await this.request<DailyNoteSnapshot>('dailyBlockMutate', { record });
        if (!next || !Array.isArray(next.blocks)) throw new Error('The native app could not confirm this change. Retry safely.');
        if (next.day === this.day()) this.snapshot.set(next);
        if (next.sync?.conflicts.some(id => id.toLowerCase() === record.requestID.toLowerCase())) { this.error.set('Your Mac could not apply this change. Your edit is kept. Refresh and review the saved version.'); return false; }
        this.notice.set(next.sync?.pending.length ? 'Saved on iPhone · waiting for your Mac' : 'Saved on this device');
        return !next.sync?.pending.length;
      } catch (e) { this.fail(e); return false; }
      finally { this.busy.set(false); }
    });
    this.writeTail = job; return job;
  }
  async saveDraft(id: string, useLatestVersion = false) {
    const draft = this.drafts()[id]; if (!draft) return true;
    const block = this.blocks().find(b => b.id === id);
    if (!block) { this.notice.set('An edit belongs to a block that moved or was cleared. It is kept in Recovered edits.'); return false; }
    if (block && this.conflict(block) && !useLatestVersion) { this.error.set('This block changed while you were writing. Your edit is kept. Review both versions below.'); return false; }
    const ok = await this.mutate({ kind: 'edit', blockID: id, expectedVersion: useLatestVersion && block ? block.version : draft.version, day: block.day, content: draft.content });
    if (ok) {
      this.drafts.update(d => {
        const current = d[id]; const copy = { ...d };
        if (current?.content === draft.content) delete copy[id];
        else if (current) copy[id] = { ...current, version: this.blocks().find(b => b.id === id)?.version ?? current.version };
        return copy;
      }); this.persistDrafts();
    }
    return ok;
  }
  discardDraft(id: string) { this.drafts.update(d => { const next = { ...d }; delete next[id]; return next; }); this.persistDrafts(); this.error.set(''); }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer); await this.writeTail;
    for (const id of Object.keys(this.drafts())) if (this.blocks().some(block => block.id === id) && !await this.saveDraft(id)) return false;
    return true;
  }
  async recoverDraft(id: string) {
    const draft = this.drafts()[id]; if (!draft) return false;
    let copyID = this.recoveryIDs.get(id); if (!copyID) { copyID = crypto.randomUUID(); this.recoveryIDs.set(id, copyID); try { localStorage.setItem('maple.daily.recoveryIDs.v1', JSON.stringify([...this.recoveryIDs])); } catch { this.error.set('Could not preserve a recovery request. Keep this page open and try again.'); return false; } }
    const ok = await this.create('text', draft.content, copyID);
    if (ok) this.discardDraft(id);
    return ok;
  }
  async create(kind: DailyBlockKind, content: string, id: string) {
    if (this.blocks().some(block => block.id === id && block.kind === kind && block.content === content)) return true;
    return this.mutate({ kind: 'create', blockID: id, expectedVersion: 0, day: this.day(), blockKind: kind, content });
  }
  async action(block: DailyBlock, kind: 'clear' | 'restore' | 'move' | 'complete', targetDay?: string) {
    if (!await this.flush()) return false;
    const latest = [...(this.snapshot()?.blocks ?? []), ...(this.snapshot()?.cleared ?? [])].find(b => b.id === block.id) ?? block;
    const ok = await this.mutate({ kind, blockID: latest.id, expectedVersion: latest.version, day: latest.day, targetDay });
    if (ok && kind === 'clear') this.undoBlock.set(this.snapshot()?.cleared.find(b => b.id === block.id) ?? null);
    if (ok && kind === 'restore') this.undoBlock.set(null);
    return ok;
  }
  async undo() { const block = this.undoBlock(); if (block) await this.action(block, 'restore'); }
  async move(block: DailyBlock) { return this.action(block, 'move', offsetDay(this.day(), 1)); }
  history(id: string) { return this.request<DailyHistory[]>('dailyBlockHistory', { id }); }
  private fail(e: unknown) { this.error.set(e instanceof Error ? e.message : 'Could not save this change. Your text is kept; retry when ready.'); }
}
