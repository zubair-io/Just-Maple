import { Injectable, computed, inject, signal } from '@angular/core';
import { isCompanion } from '../core/companion-host';
import { NativeBridge } from '../core/native-bridge.service';
import { QualityCaptureReceipt, QualityCaptureRequest, QualityCaptureResponse } from '../core/quality-capture.models';
import { WorldSnapshot } from './world.models';
import { captureDigestedCurrentTaskProjection, canonicalTaskProjectionJSON, CurrentTaskProjection } from './task-projection-capture';

interface PendingCapture { request: QualityCaptureRequest; projection: CurrentTaskProjection }
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function macHostAvailable() {
  return !isCompanion() && typeof (window as unknown as { webkit?: { messageHandlers?: { maple?: { postMessage?: unknown } } } }).webkit?.messageHandlers?.maple?.postMessage === 'function';
}
@Injectable({ providedIn: 'root' })
export class QualityCaptureService {
  private readonly bridge = inject(NativeBridge);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly receipt = signal<QualityCaptureReceipt | null>(null);
  readonly projection = signal<CurrentTaskProjection | null>(null);
  private readonly pendingCapture = signal<PendingCapture | null>(null);
  readonly retryAvailable = computed(() => !!this.pendingCapture() && !this.busy());
  readonly ready = computed(() => macHostAvailable() && this.bridge.state().loaded && !!this.bridge.state().world && !this.bridge.pending() && !this.busy());

  async capture(): Promise<boolean> {
    if (!this.ready()) return false;
    this.busy.set(true); this.error.set(''); this.receipt.set(null); this.projection.set(null); this.pendingCapture.set(null);
    try {
      // Take the exact accepted UI value before awaiting hashes. No snapshot refresh,
      // inference request, task mutation, or reconstruction of past UI occurs here.
      const worldJSON = JSON.stringify(this.bridge.state().world);
      const world = JSON.parse(worldJSON) as WorldSnapshot;
      const capturedAt = new Date().toISOString();
      const worldSHA256 = await sha256(worldJSON);
      const { projection, integrity } = await captureDigestedCurrentTaskProjection({
        world, expectedWorldRevision: world.revision, worldHash: worldSHA256, capturedAt,
        loaded: true, pending: false, scope: 'unfiltered-task-tabs',
      });
      if (!macHostAvailable() || !this.bridge.state().loaded || this.bridge.pending() || JSON.stringify(this.bridge.state().world) !== worldJSON) {
        this.error.set('The task snapshot changed while preparing the capture. Capture current lists again.');
        return false;
      }
      const pending: PendingCapture = { projection, request: Object.freeze({ schemaVersion: 1, captureID: crypto.randomUUID(),
        worldRevision: world.revision, worldJSON, worldSHA256, projectionJSON: canonicalTaskProjectionJSON(projection),
        projectionSHA256: integrity.digest, capturedAt: projection.capturedAt }) };
      this.pendingCapture.set(pending);
      return await this.save(pending);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The local capture could not be saved.');
      return false;
    } finally { this.busy.set(false); }
  }
  async retry(): Promise<boolean> {
    const pending = this.pendingCapture();
    if (!pending || this.busy() || this.bridge.pending() || !macHostAvailable() || !this.bridge.state().loaded) return false;
    this.busy.set(true); this.error.set('');
    try {
      // A receipt may have been lost after the native atomic save. Replay the exact
      // identity/bytes, even if the UI has since advanced; native checks committed IDs first.
      return await this.save(pending);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The capture receipt could not be recovered.');
      return false;
    } finally { this.busy.set(false); }
  }
  private async save(pending: PendingCapture): Promise<boolean> {
    const response = await this.bridge.captureQualitySnapshot(pending.request);
    if (!response || response.schemaVersion !== 1 || response.captureID !== pending.request.captureID)
      throw Error('The Mac returned an invalid capture receipt. Retry to recover the saved capture.');
    if (response.status === 'stale') {
      this.pendingCapture.set(null);
      this.error.set('The task snapshot changed before it could be frozen. Capture current lists again.');
      return false;
    }
    if (!this.matchesReceipt(response, pending.request))
      throw Error('The Mac capture receipt did not match these lists. Retry to recover the saved capture.');
    this.receipt.set(Object.freeze({ ...response })); this.projection.set(pending.projection); this.pendingCapture.set(null);
    return true;
  }
  private matchesReceipt(response: QualityCaptureResponse, request: QualityCaptureRequest): response is QualityCaptureReceipt {
    return response.status === 'saved' && response.evaluation === 'not_run' &&
      typeof response.path === 'string' && response.path.startsWith('/') && !response.path.includes('\0') &&
      response.capturedAt === request.capturedAt && response.worldRevision === request.worldRevision &&
      response.worldSHA256 === request.worldSHA256 && response.projectionSHA256 === request.projectionSHA256;
  }
}
