import { Injectable, inject } from "@angular/core";
import { NativeBridge } from "../core/native-bridge.service";
export interface SourceQuery {
  types: string[];
  connectors: string[];
  accounts: string[];
  states: string[];
  text?: string;
  receivedAfter?: string;
  receivedBefore?: string;
}
export interface SourceCursor {
  sessionID: string;
  offset: number;
  fingerprint: string;
}
export interface SourceRow {
  id: string;
  type: string;
  connector: string;
  account: string;
  externalID: string;
  revision: string;
  sender: string;
  subject: string;
  preview: string;
  status: string;
  statusDetail: string;
  occurredAt: string | number;
  receivedAt: string | number;
  stateVersion: number;
  classificationState?: string;
  analysisState?: string;
  observedState?: string;
}
export interface SourcePage {
  schemaVersion: number;
  items: SourceRow[];
  nextCursor?: SourceCursor;
  total: number;
  asOf: string | number;
  hasMoreMatches: boolean;
  facets: {
    types: string[];
    connectors: string[];
    accounts: string[];
    states: string[];
  };
}
export interface SourceStage {
  stage: string;
  state: string;
  version: number;
  attemptID?: string;
  reason?: string;
  relatedEventID?: string;
}
export interface SourceArtifact {
  id: string;
  stage: string;
  kind: string;
  availability: string;
  mediaType: string;
  byteCount: number;
  legacy: boolean;
  attemptID?: string;
  provider?: string;
  model?: string;
}
export interface SourceDetail {
  schemaVersion: number;
  row: SourceRow;
  content: string;
  truncated: boolean;
  subjects: string[];
  stages: SourceStage[];
  artifacts: SourceArtifact[];
  relatedRevisions: string[];
  backlinks?: {
    documentID: string;
    path: string;
    day?: string;
    blockID: string;
    revision?: string;
  }[];
  attempts?: {
    id: string;
    stage: string;
    parentAttemptID?: string;
    provider?: string;
    model?: string;
    startedAt: string | number;
    endedAt?: string | number;
    transportOutcome: string;
    commitOutcome: string;
  }[];
  historyAvailability: string;
  asOf: string;
}
export interface SourceTransition {
  sequence: number;
  eventID: string;
  stage: string;
  fromState?: string;
  toState: string;
  attemptID?: string;
  reason?: string;
  relatedEventID?: string;
  at: string | number;
  artifacts?: SourceArtifact[];
}
export interface SourceHistoryPage {
  items: SourceTransition[];
  nextSequence?: number;
}
export interface SourceArtifactPage {
  id: string;
  availability: string;
  content: string;
  offset: number;
  totalBytes: number;
  complete: boolean;
  nextOffset?: number;
}
export const sourceDate = (value: string | number) =>
  typeof value === "number" ? value * 1000 : value;
export const emptySourceQuery = (): SourceQuery => ({
  types: [],
  connectors: [],
  accounts: [],
  states: [],
});
@Injectable({ providedIn: "root" })
export class SourcesService {
  searchText = "";
  private readonly bridge = inject(NativeBridge);
  private cache = new Map<string, Promise<SourceDetail>>();
  list(query: SourceQuery, cursor?: SourceCursor) {
    return this.bridge.notebook<SourcePage>("sourceList", {
      query,
      cursor,
      limit: 60,
    });
  }
  detail(eventID: string, fresh = false): Promise<SourceDetail> {
    if (fresh) this.cache.delete(eventID);
    let result = this.cache.get(eventID);
    if (!result) {
      result = this.bridge.notebook<SourceDetail>("sourceDetail", { eventID });
      this.cache.set(eventID, result);
      result.catch(() => this.cache.delete(eventID));
      if (this.cache.size > 120)
        this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }
  history(eventID: string, beforeSequence?: number) {
    return this.bridge.notebook<SourceHistoryPage>("sourceHistory", {
      eventID,
      beforeSequence,
      limit: 50,
    });
  }
  artifact(eventID: string, artifactID: string, offset = 0) {
    return this.bridge.notebook<SourceArtifactPage>("sourceArtifact", {
      eventID,
      artifactID,
      offset,
      limit: 65536,
    });
  }
  retry(
    eventID: string,
    stage: string,
    expectedVersion: number,
    commandID: string,
  ) {
    return this.bridge.notebook<{ status: string }>("sourceRetry", {
      commandID,
      eventID,
      stage,
      expectedVersion,
    });
  }
}
