import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeBridge, emptySnapshot } from '../core/native-bridge.service';
import { QualityCaptureReceipt, QualityCaptureRequest } from '../core/quality-capture.models';
import { WorkspaceComponent } from '../pages/workspace.component';
import { QualityCaptureComponent } from './quality-capture.component';
import { QualityCaptureService } from './quality-capture.service';
import { WorldSnapshot, emptyWorld, newTask } from './world.models';

function receipt(request: QualityCaptureRequest): QualityCaptureReceipt {
  return { schemaVersion: 1, captureID: request.captureID, status: 'saved', path: '/private/synthetic/QualityCaptures/' + request.captureID,
    capturedAt: request.capturedAt, worldRevision: request.worldRevision, worldSHA256: request.worldSHA256,
    projectionSHA256: request.projectionSHA256, evaluation: 'not_run' };
}
function setup() {
  const postMessage = vi.fn(async (body: QualityCaptureRequest) => receipt(body));
  vi.stubGlobal('webkit', { messageHandlers: { maple: { postMessage } } });
  const bridge = TestBed.inject(NativeBridge);
  const world: WorldSnapshot = { ...emptyWorld, revision: 7, asOf: Date.now() / 1000 - 5, tasks: [
    { ...newTask(), id: 'synthetic-open', title: 'Synthetic private task', evidenceIDs: ['synthetic-source'], version: 3 },
    { ...newTask(), id: 'synthetic-waiting', status: 'waiting', version: 2 },
    { ...newTask(), id: 'synthetic-later', version: 4, actionState: { lastAction: 'later', lastMutationID: 'synthetic-mutation', resurfaceAt: Date.now() / 1000 + 3600 } },
  ] };
  bridge.state.set({ ...emptySnapshot, loaded: true, step: -1, world });
  return { bridge, world, postMessage, service: TestBed.inject(QualityCaptureService) };
}
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
it('sends only an explicit typed local capture of exact accepted world bytes and shared UI projection', async () => {
  const { bridge, world, postMessage, service } = setup();
  expect(postMessage).not.toHaveBeenCalled(); const original = JSON.stringify(world);
  expect(await service.capture()).toBe(true);
  expect(postMessage).toHaveBeenCalledOnce();
  const body = postMessage.mock.calls[0][0] as QualityCaptureRequest & { action: string };
  expect(body.action).toBe('qualityCapture'); expect(body.worldJSON).toBe(original);
  expect(body.worldSHA256).toBe(await digest(original)); expect(body.projectionSHA256).toBe(await digest(body.projectionJSON));
  const projection = JSON.parse(body.projectionJSON);
  expect(projection.world.hash.value).toBe(body.worldSHA256);
  expect(projection.surfaces.needsYou.map((row: any) => row.rankedNode.id)).toEqual(['task:synthetic-open']);
  expect(projection.surfaces.waiting.map((row: any) => row.rankedNode.id)).toEqual(['task:synthetic-waiting']);
  expect(projection.surfaces.later.map((row: any) => row.rankedNode.id)).toEqual(['task:synthetic-later']);
  expect(service.receipt()?.evaluation).toBe('not_run'); expect(service.retryAvailable()).toBe(false);
  expect(bridge.state().world).toBe(world); expect(JSON.stringify(world)).toBe(original);
});
it('waits for a matching native durable receipt before displaying saved counts or path', async () => {
  const { service, postMessage } = setup(); let finish!: (result: QualityCaptureReceipt) => void;
  postMessage.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const saving = service.capture(); await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
  expect(service.busy()).toBe(true); expect(service.receipt()).toBeNull(); expect(service.projection()).toBeNull();
  expect(await service.capture()).toBe(false); expect(postMessage).toHaveBeenCalledOnce();
  finish(receipt(postMessage.mock.calls[0][0])); expect(await saving).toBe(true);
  expect(service.receipt()?.path).toContain('/private/synthetic/'); expect(service.projection()?.topTenNeedsYou).toHaveLength(1);
});
it('preserves exact retry identity and payload after an unknown outcome, even after the UI advances', async () => {
  const { service, postMessage, bridge } = setup();
  postMessage.mockRejectedValueOnce(Error('Synthetic acknowledgement lost'));
  expect(await service.capture()).toBe(false); expect(service.receipt()).toBeNull(); expect(service.retryAvailable()).toBe(true);
  const first = postMessage.mock.calls[0][0];
  bridge.state.update(state => ({ ...state, world: { ...state.world!, revision: 8, tasks: [] } }));
  expect(await service.retry()).toBe(true);
  expect(postMessage.mock.calls[1][0]).toEqual(first);
  expect(service.receipt()?.worldRevision).toBe(7); expect(service.projection()?.surfaces.needsYou).toHaveLength(1);
});
it('requires a fresh capture after typed native drift instead of retrying a stale payload', async () => {
  const { service, postMessage } = setup();
  postMessage.mockImplementationOnce(async request => ({ schemaVersion: 1, captureID: request.captureID, status: 'stale', message: 'Changed' }) as any);
  expect(await service.capture()).toBe(false); expect(service.retryAvailable()).toBe(false); expect(service.receipt()).toBeNull();
  expect(service.error()).toContain('Capture current lists again');
  expect(await service.retry()).toBe(false); expect(postMessage).toHaveBeenCalledOnce();
  expect(await service.capture()).toBe(true); expect(postMessage.mock.calls[1][0].captureID).not.toBe(postMessage.mock.calls[0][0].captureID);
});
it('does not accept malformed, hash-mismatched or wrong-identity receipts as success', async () => {
  const { service, postMessage } = setup();
  for (const wrong of [{ captureID: 'wrong' }, { projectionSHA256: 'b'.repeat(64) }, { worldRevision: 80 }, { evaluation: 'complete' }, { path: 'https://example.invalid/export' }, { capturedAt: '2000-01-01T00:00:00Z' }]) {
    postMessage.mockImplementationOnce(async request => ({ ...receipt(request), ...wrong }) as any);
    expect(await service.capture()).toBe(false); expect(service.receipt()).toBeNull(); expect(service.retryAvailable()).toBe(true);
  }
});
it('aborts locally if accepted world changes while hashes are being prepared', async () => {
  const { service, bridge, postMessage } = setup();
  const realDigest = crypto.subtle.digest.bind(crypto.subtle); let release!: () => void;
  const barrier = new Promise<void>(resolve => release = resolve);
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, bytes) => { await barrier; return realDigest(algorithm, bytes); });
  const pending = service.capture();
  bridge.state.update(state => ({ ...state, world: { ...state.world!, revision: 8 } })); release();
  expect(await pending).toBe(false); expect(postMessage).not.toHaveBeenCalled(); expect(service.retryAvailable()).toBe(false);
  expect(service.error()).toContain('snapshot changed');
});
it('refuses capture from an unloaded, pending, missing-world or iPhone state', async () => {
  const { service, bridge, postMessage } = setup();
  bridge.pending.set(true); expect(await service.capture()).toBe(false); bridge.pending.set(false);
  bridge.state.update(state => ({ ...state, loaded: false })); expect(await service.capture()).toBe(false);
  bridge.state.update(state => ({ ...state, loaded: true, world: null })); expect(await service.capture()).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
  TestBed.resetTestingModule(); vi.stubGlobal('mapleHost', 'iphone'); const phone = setup();
  expect(await phone.service.capture()).toBe(false); expect(phone.postMessage).not.toHaveBeenCalled();
});
it('shows a secondary explicit panel, privacy disclosure, counts and capture-only outcome', async () => {
  const { service, postMessage } = setup(); const fixture = TestBed.createComponent(QualityCaptureComponent);
  fixture.detectChanges(); await fixture.whenStable();
  expect(postMessage).not.toHaveBeenCalled(); expect(fixture.nativeElement.querySelector('details').open).toBe(false);
  const text = fixture.nativeElement.textContent;
  expect(text).toContain('private local task and source evidence'); expect(text).toContain('outside iCloud'); expect(text).toContain('no models are run');
  const capture = vi.spyOn(service, 'capture');
  fixture.nativeElement.querySelector('button').click();
  expect(capture).toHaveBeenCalledOnce();
  // WebCrypto may finish after Angular reports stability. Await the actual
  // button-triggered save and receipt validation, not a timing delay.
  expect(await capture.mock.results[0].value).toBe(true);
  await fixture.whenStable(); fixture.detectChanges();
  expect(service.receipt()).not.toBeNull(); expect(fixture.nativeElement.textContent).toContain('Quality evaluation not run');
  expect(fixture.nativeElement.textContent).toContain('1 Needs you · 1 Waiting · 1 Later');
  expect(fixture.nativeElement.textContent).toContain(service.receipt()!.path); fixture.destroy();
});
it('mounts capture on Processing without causing a native call on page load', async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: { page: 'Activity' } } } }] });
  const { postMessage } = setup(); const fixture = TestBed.createComponent(WorkspaceComponent);
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('maple-quality-capture')).toBeTruthy(); expect(postMessage).not.toHaveBeenCalled(); fixture.destroy();
});
