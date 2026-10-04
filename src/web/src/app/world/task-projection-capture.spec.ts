import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot, NativeBridge } from '../core/native-bridge.service';
import { TasksComponent } from './tasks.component';
import { emptyWorld, LifeTask, Suggestion, WorldSnapshot } from './world.models';
import { captureCurrentTaskProjection, captureDigestedCurrentTaskProjection, canonicalTaskProjectionJSON, CurrentTaskProjectionInput } from './task-projection-capture';
const now = Date.UTC(2026, 8, 30, 12) / 1000;
function task(id: string, changes: Partial<LifeTask> = {}): LifeTask {
  return { id, ownerID: 'local', title: 'Private synthetic title', description: 'Private synthetic writing', status: 'open', waitingReason: '', assignee: '', place: '', people: [], priority: 0, conditions: [], evidenceIDs: ['evidence-' + id], activityIDs: [], version: 4, createdAt: now - 100, updatedAt: now - 50, ...changes };
}
function suggestion(id: string, changes: Partial<Suggestion> = {}): Suggestion {
  return { id, candidate: task('candidate-' + id), eventID: 'evidence-' + id, fingerprint: id, sourceKey: id, quote: 'Private synthetic quote', provider: 'synthetic', deadlineExplanation: '', reviewStatus: 'pending', possibleDuplicateIDs: [], version: 19, createdAt: now - 100, ...changes };
}
function world(): WorldSnapshot {
  return { ...emptyWorld, revision: 42, asOf: now, tasks: [
    ...Array.from({ length: 13 }, (_, i) => task('task-' + String(i).padStart(2, '0'))),
    task('waiting', { status: 'waiting', due: { kind: 'date', date: '2026-09-01', timeZone: 'UTC' } }),
    task('waiting-later', { status: 'waiting', actionState: { lastMutationID: 'mutation', lastAction: 'later', resurfaceAt: now + 60 } }),
    task('deferred', { actionState: { lastMutationID: 'mutation', lastAction: 'later', resurfaceAt: now + 60 } }),
    task('resurfaced', { actionState: { lastMutationID: 'mutation', lastAction: 'later', resurfaceAt: now } }),
    task('completed', { status: 'completed' }), task('cancelled', { status: 'cancelled' }),
  ], suggestions: [suggestion('linked', { linkedTaskID: 'task-00', version: 99 }), suggestion('detected'), suggestion('dismissed', { reviewStatus: 'dismissed' })],
    taskRelations: [{ duplicateID: 'task:task-02', primaryID: 'task:task-01', reason: 'Synthetic duplicate', evidenceIDs: ['evidence-task-02'] }],
    taskProgress: [{ nodeID: 'task:task-01', status: 'open', eventID: 'progress-evidence', quote: 'Private quote', reason: 'Synthetic supported reason', observedAt: now - 10 }],
  };
}
function input(overrides: Partial<CurrentTaskProjectionInput> = {}): CurrentTaskProjectionInput {
  return { world: world(), expectedWorldRevision: 42, worldHash: 'a'.repeat(64), capturedAt: '2026-09-30T12:00:02Z', loaded: true, pending: false, scope: 'unfiltered-task-tabs', ...overrides };
}
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });
describe('current-only final task tab projection capture', () => {
  it('matches the actual component ranking, membership, rendered identities and top ten for all three tabs', async () => {
    const request = input(), capture = captureCurrentTaskProjection(request);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }] });
    const bridge = TestBed.inject(NativeBridge);
    bridge.state.set({ ...emptySnapshot, loaded: true, step: -1, world: request.world });
    vi.spyOn(bridge, 'group').mockResolvedValue([]);
    const fixture = TestBed.createComponent(TasksComponent);
    try {
      for (const [filter, key] of [['Needs you', 'needsYou'], ['Waiting', 'waiting'], ['Later', 'later']] as const) {
        fixture.componentInstance.filter.set(filter); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(capture.surfaces[key].map(row => row.rankedNode.id)).toEqual(fixture.componentInstance.tasks().map(item => item.id));
        const visible = [...fixture.nativeElement.querySelectorAll('.ranked-task')].map((element: Element) => element.hasAttribute('data-suggestion-id') ? 'source:' + element.getAttribute('data-suggestion-id') : 'task:' + element.getAttribute('data-task-id'));
        expect(capture.surfaces[key].map(row => row.renderedRow.id)).toEqual(visible);
      }
      expect(capture.topTenNeedsYou).toHaveLength(10);
      expect(capture.topTenNeedsYou).toEqual(capture.surfaces.needsYou.slice(0, 10));
      expect(capture.visibility).toBe('tab-membership-not-viewport');
    } finally { fixture.destroy(); }
  });
  it('preserves canonical vs rendered suggestion versions, merged evidence and actual overlapping membership', () => {
    const capture = captureCurrentTaskProjection(input());
    const linked = capture.surfaces.needsYou.find(row => row.rankedNode.id === 'task:task-00')!;
    expect(linked.rankedNode.version).toBe(4); expect(linked.renderedRow).toEqual({ id: 'source:linked', version: 99 });
    const detected = capture.surfaces.needsYou.find(row => row.rankedNode.id === 'source:detected')!;
    expect(detected.rankedNode.version).toBe(19);
    const merged = capture.surfaces.needsYou.find(row => row.rankedNode.id === 'task:task-01')!;
    expect(merged.sourceEventIDs).toEqual(expect.arrayContaining(['evidence-task-01', 'evidence-task-02', 'progress-evidence']));
    const needs = capture.surfaces.needsYou.map(row => row.rankedNode.id);
    expect(needs).not.toContain('task:task-02'); expect(needs).not.toContain('task:waiting'); expect(needs).not.toContain('task:deferred');
    expect(needs).not.toContain('task:completed'); expect(needs).not.toContain('source:dismissed'); expect(needs).toContain('task:resurfaced');
    expect(capture.surfaces.waiting.map(row => row.rankedNode.id)).toContain('task:waiting-later');
    expect(capture.surfaces.later.map(row => row.rankedNode.id)).toContain('task:waiting-later');
  });
  it('freezes detached identity/evidence rows without freezing the source or exporting private writing', () => {
    const request = input(), capture = captureCurrentTaskProjection(request), before = canonicalTaskProjectionJSON(capture);
    request.world.tasks[0].version++; request.world.tasks[0].evidenceIDs.push('new-evidence'); request.world.suggestions[0].version++;
    expect(canonicalTaskProjectionJSON(capture)).toBe(before); expect(Object.isFrozen(request.world)).toBe(false);
    expect(Object.isFrozen(capture)).toBe(true); expect(Object.isFrozen(capture.surfaces.needsYou[0].sourceEventIDs)).toBe(true);
    expect(() => (capture.surfaces.needsYou as any).push({})).toThrow();
    expect(before).not.toContain('Private synthetic'); expect(capture.currentOnly).toBe(true);
    expect(capture.world.hash.verified).toBe(false); expect(capture.world.hash.source).toBe('caller-supplied');
  });
  it('rejects unloaded/pending/revision-drift/future worlds, bad timestamps and unverifiable hash inputs', () => {
    for (const changes of [{ loaded: false }, { pending: true }, { expectedWorldRevision: 41 }, { capturedAt: '2026-09-30T11:59:59Z' }, { capturedAt: '2026-09-30T12:00:00' }, { worldHash: 'not-a-digest' }, { scope: 'overview' as any }])
      expect(() => captureCurrentTaskProjection(input(changes))).toThrow();
    const bad = input(); bad.world.asOf = NaN; expect(() => captureCurrentTaskProjection(bad)).toThrow();
  });
  it('rejects nonexistent calendar dates and out-of-range clock or offset fields', () => {
    for (const capturedAt of ['2026-02-30T12:00:00Z', '2026-09-31T12:00:00Z', '2026-09-30T24:00:00Z', '2026-09-30T12:60:00Z', '2026-09-30T12:00:60Z', '2026-09-30T12:00:00+24:00', '2026-09-30T12:00:00+01:60']) {
      const request = input({ capturedAt }); request.world.asOf = 0;
      expect(() => captureCurrentTaskProjection(request)).toThrow(/calendar day, time or UTC offset/);
    }
    expect(captureCurrentTaskProjection(input({ capturedAt: '2026-09-30T08:00:02-04:00' })).capturedAt).toBe('2026-09-30T12:00:02.000Z');
  });
  it('rejects conflicting task/suggestion/reconciliation IDs and invalid versions/timing', () => {
    const cases = [
      (w: WorldSnapshot) => w.tasks.push({ ...w.tasks[0] }),
      (w: WorldSnapshot) => w.suggestions.push({ ...w.suggestions[0] }),
      (w: WorldSnapshot) => { w.tasks[0].version = -1; },
      (w: WorldSnapshot) => { w.suggestions[0].version = NaN; },
      (w: WorldSnapshot) => { w.tasks[0].due = { kind: 'date', date: '2026-02-30', timeZone: 'UTC' }; },
      (w: WorldSnapshot) => { w.tasks[0].due = { kind: 'date', date: '2026-09-30', timeZone: 'invalid' }; },
      (w: WorldSnapshot) => w.taskRelations!.push({ duplicateID: 'task:task-02', primaryID: 'task:task-03', reason: '', evidenceIDs: [] }),
      (w: WorldSnapshot) => w.taskRelations!.push({ duplicateID: 'task:task-01', primaryID: 'task:task-02', reason: '', evidenceIDs: [] }),
    ];
    for (const mutate of cases) { const request = input(); mutate(request.world); expect(() => captureCurrentTaskProjection(request)).toThrow(); }
  });
  it('keeps an empty or shorter top list truthful without padding or substituting historical rows', () => {
    const request = input({ world: { ...emptyWorld, revision: 42, asOf: now } });
    expect(captureCurrentTaskProjection(request).topTenNeedsYou).toEqual([]);
    request.world.tasks = [task('one')];
    expect(captureCurrentTaskProjection(request).topTenNeedsYou.map(row => row.rankedNode.id)).toEqual(['task:one']);
  });
  it('computes a deterministic body digest and freezes before asynchronous hashing', async () => {
    const request = input(), pending = captureDigestedCurrentTaskProjection(request);
    request.world.tasks[0].version = 100;
    const result = await pending, again = await captureDigestedCurrentTaskProjection(input());
    expect(result).toEqual(again); expect(result.integrity.digest).toMatch(/^[a-f0-9]{64}$/);
    const different = await captureDigestedCurrentTaskProjection(request); expect(different.integrity.digest).not.toBe(result.integrity.digest);
    expect(Object.isFrozen(result.integrity)).toBe(true);
    const reordered = { ...result.projection, surfaces: { later: result.projection.surfaces.later, waiting: result.projection.surfaces.waiting, needsYou: result.projection.surfaces.needsYou } };
    expect(canonicalTaskProjectionJSON(reordered)).toBe(canonicalTaskProjectionJSON(result.projection));
  });
});
