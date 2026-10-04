import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSourceQuery, sourceDateRange } from "./source-filters";
import { SourcesComponent } from "./sources.component";
import { SourcesService } from "./sources.service";
import { TodayDocumentService } from "../today/today-document.service";

afterEach(() => TestBed.resetTestingModule());
describe("Received-date source filters", () => {
  it("uses inclusive local calendar boundaries serialized as UTC, including daylight-saving dates", () => {
    for (const [year, month, day] of [
      [2026, 2, 8],
      [2026, 10, 1],
    ]) {
      const value = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const range = sourceDateRange(value, value);
      expect(range.receivedAfter).toBe(
        new Date(year, month, day, 0, 0, 0, 0).toISOString(),
      );
      expect(range.receivedBefore).toBe(
        new Date(
          new Date(year, month, day + 1, 0, 0, 0, 0).getTime() - 1,
        ).toISOString(),
      );
      const end = new Date(range.receivedBefore!);
      expect(end.getDate()).toBe(day);
      expect(end.getHours()).toBe(23);
      expect(end.getMilliseconds()).toBe(999);
    }
  });
  it("supports open-ended ranges and rejects invalid or reversed calendar days", () => {
    expect(sourceDateRange("", "")).toEqual({
      receivedAfter: undefined,
      receivedBefore: undefined,
    });
    expect(sourceDateRange("2026-09-27", "").receivedBefore).toBeUndefined();
    expect(sourceDateRange("", "2026-09-27").receivedAfter).toBeUndefined();
    expect(() => sourceDateRange("2026-02-29", "")).toThrow("valid");
    expect(() => sourceDateRange("2026-09-28", "2026-09-27")).toThrow(
      "on or before",
    );
  });
  it("combines dates with independent type, connector, account and state dimensions", () => {
    const query = buildSourceQuery({
      search: " Dominick ",
      type: "email",
      connector: "gmail",
      account: "work",
      state: "pending",
      receivedFrom: "2026-09-01",
      receivedTo: "2026-09-27",
    });
    expect(query).toEqual({
      types: ["email"],
      connectors: ["gmail"],
      accounts: ["work"],
      states: ["pending"],
      text: "Dominick",
      ...sourceDateRange("2026-09-01", "2026-09-27"),
    });
  });
  it("restores date query parameters, persists apply, and clears dates on reset", async () => {
    const params = new BehaviorSubject(
      convertToParamMap({
        receivedFrom: "2026-09-01",
        receivedTo: "2026-09-27",
        type: "email",
        account: "work",
      }),
    );
    const service = {
      searchText: "",
      list: vi
        .fn()
        .mockResolvedValue({
          schemaVersion: 1,
          items: [],
          total: 0,
          asOf: 0,
          hasMoreMatches: false,
          facets: { types: [], connectors: [], accounts: [], states: [] },
        }),
    };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: SourcesService, useValue: service },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({})),
            queryParamMap: params,
          },
        },
        {
          provide: TodayDocumentService,
          useValue: { pendingSource: signal(null) },
        },
      ],
    });
    const component = TestBed.runInInjectionContext(
      () => new SourcesComponent(),
    );
    component.ngOnInit();
    expect(service.list.mock.calls[0][0]).toEqual({
      ...sourceDateRange("2026-09-01", "2026-09-27"),
      types: ["email"],
      accounts: ["work"],
      connectors: [],
      states: [],
      text: undefined,
    });
    component.receivedFrom = "2026-09-02";
    component.apply();
    expect(router.navigate).toHaveBeenLastCalledWith(["/sources"], {
      queryParams: {
        type: ["email"],
        account: ["work"],
        source: undefined,
        state: undefined,
        receivedFrom: "2026-09-02",
        receivedTo: "2026-09-27",
      },
    });
    component.reset();
    expect(component.receivedFrom).toBe("");
    expect(component.receivedTo).toBe("");
    expect(service.list.mock.calls.at(-1)?.[0].receivedAfter).toBeUndefined();
    expect(
      router.navigate.mock.calls.at(-1)?.[1].queryParams.receivedTo,
    ).toBeUndefined();
    const calls = service.list.mock.calls.length;
    component.receivedFrom = "2026-09-30";
    component.receivedTo = "2026-09-01";
    component.apply();
    expect(service.list.mock.calls).toHaveLength(calls);
    expect(component.filterError()).toContain("on or before");
    component.ngOnDestroy();
  });
});

describe('Sources snapshot controls', () => {
  function setup() {
    const params = new BehaviorSubject(convertToParamMap({ type: ['email', 'imessage'], source: ['gmail'], account: ['work'], state: ['pending', 'failed'] }));
    const cursor = { sessionID: 'frozen', offset: 0, fingerprint: 'fixture' };
    const item = { id: 'old', subject: 'Frozen observation' };
    const page = { items: [item], total: 1, asOf: 1, snapshotCursor: cursor, hasMoreMatches: false, facets: { types: ['email', 'imessage'], connectors: ['gmail'], accounts: ['work'], states: ['pending', 'failed'] } };
    const service = { searchText: '', list: vi.fn().mockResolvedValue(page), changes: vi.fn().mockResolvedValue({ hasNewEntries: false }) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({ providers: [
      { provide: SourcesService, useValue: service }, { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({})), queryParamMap: params } },
      { provide: TodayDocumentService, useValue: { pendingSource: signal(null) } },
    ] });
    const component = TestBed.runInInjectionContext(() => new SourcesComponent());
    component.ngOnInit();
    return { component, service, router, params, cursor, item };
  }
  it('preserves OR values, chips and local search through Back/Forward without reopening an identical snapshot', async () => {
    const { component, service, router, params } = setup(); await Promise.resolve();
    expect(service.list.mock.calls[0][0]).toMatchObject({ types: ['email', 'imessage'], connectors: ['gmail'], accounts: ['work'], states: ['failed', 'pending'] });
    expect(component.activeFilters()).toHaveLength(6);
    params.next(convertToParamMap({ type: ['imessage', 'email'], source: ['gmail'], account: ['work'], state: ['failed', 'pending'] }));
    expect(service.list).toHaveBeenCalledTimes(1);
    component.search = 'private body text'; component.apply(); await Promise.resolve();
    expect(JSON.stringify(router.navigate.mock.calls.at(-1))).not.toContain('private body text');
    expect(service.searchText).toBe('private body text');
    component.type = ['unapplied draft']; component.removeFilter('type', 'email');
    expect(service.list.mock.calls.at(-1)?.[0].types).toEqual(['imessage']);
    params.next(convertToParamMap({ type: ['email', 'imessage'] }));
    expect(service.list.mock.calls.at(-1)?.[0]).toMatchObject({ types: ['email', 'imessage'], text: 'private body text' });
    component.reset(); expect(component.activeFilters()).toEqual([]); expect(service.searchText).toBe('');
    component.ngOnDestroy();
  });
  it('announces arrivals without changing rows, selection or snapshot until explicit refresh', async () => {
    const { component, service, cursor } = setup(); await Promise.resolve();
    const rows = component.rows(); component.selected.set('old');
    service.changes.mockResolvedValue({ hasNewEntries: true });
    await component.checkArrivals();
    expect(service.changes).toHaveBeenCalledWith(expect.objectContaining({ types: ['email', 'imessage'] }), cursor);
    expect(component.newEntries()).toBe(true); expect(component.rows()).toBe(rows); expect(component.selected()).toBe('old');
    expect(service.list).toHaveBeenCalledTimes(1);
    await component.checkArrivals(); expect(service.changes).toHaveBeenCalledTimes(1);
    await component.refresh(); expect(component.newEntries()).toBe(false); expect(service.list).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });
  it('ignores stale checks and keeps frozen rows on unavailable or expired arrival checks', async () => {
    const { component, service } = setup(); await Promise.resolve();
    let finish!: (value: {hasNewEntries: boolean}) => void;
    service.changes.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = component.checkArrivals();
    await component.refresh(); finish({ hasNewEntries: true }); await pending;
    expect(component.newEntries()).toBe(false);
    const rows = component.rows(); service.changes.mockRejectedValue(Error('Expired'));
    await component.checkArrivals(); expect(component.rows()).toBe(rows); expect(component.arrivalError()).toContain('Refresh');
    const calls = service.list.mock.calls.length;
    component.ngOnDestroy(); await component.checkArrivals();
    expect(service.list).toHaveBeenCalledTimes(calls);
  });
});
