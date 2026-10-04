/** Local Mac capture transport. These are capture artifacts, not scored predictions. */
export interface QualityCaptureRequest {
  schemaVersion: 1;
  captureID: string;
  worldRevision: number;
  worldJSON: string;
  worldSHA256: string;
  projectionJSON: string;
  projectionSHA256: string;
  capturedAt: string;
}
export interface QualityCaptureReceipt {
  schemaVersion: 1;
  captureID: string;
  status: 'saved';
  path: string;
  capturedAt: string;
  worldRevision: number;
  worldSHA256: string;
  projectionSHA256: string;
  evaluation: 'not_run';
}
export interface QualityCaptureStale {
  schemaVersion: 1;
  captureID: string;
  status: 'stale';
  message: string;
}
export type QualityCaptureResponse = QualityCaptureReceipt | QualityCaptureStale;
