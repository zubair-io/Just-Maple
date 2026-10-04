import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription } from "rxjs";
import { MuiButtonComponent } from "@maple/ui";
import {
  SourcesService,
  SourceRow,
  SourceQuery,
  SourceCursor,
  SourcePage,
  emptySourceQuery,
  sourceDate,
} from "./sources.service";
import { buildSourceQuery } from "./source-filters";
import { SourceDetailComponent } from "./source-detail.component";
import { TodayDocumentService } from "../today/today-document.service";
@Component({
  selector: "maple-sources",
  standalone: true,
  imports: [DatePipe, FormsModule, MuiButtonComponent, SourceDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <section class="sources-page">
    <header>
      <div>
        <p class="eyebrow">Your connected world</p>
        <h1>Sources</h1>
        <p class="intro">
          Every observation, with the evidence behind its state.
        </p>
      </div>
      <mui-button variant="ghost" (pressed)="router.navigate(['/processing'])"
        >View processing</mui-button>
      <mui-button variant="ghost" [disabled]="loading()" (pressed)="refresh()"
        >Refresh</mui-button
      >
    </header>
    <form class="filters" (ngSubmit)="apply()">
      <label
        >Find a source<input
          type="search"
          name="search"
          [(ngModel)]="search"
          placeholder="Sender, subject or captured text"
      /></label>
      @for (dimension of dimensions; track dimension.key) {
        <details class="filter-options">
          <summary>{{ dimension.label }} · {{ this[dimension.key].length || 'All' }}</summary>
          <fieldset>
            <legend class="sr-only">{{ dimension.label }} — select any matching values</legend>
            @for (value of facets()[dimension.facet]; track value) {
              <label class="filter-choice"><input type="checkbox"
                [checked]="this[dimension.key].includes(value)"
                (change)="toggleFilter(dimension.key, value)" />{{ value }}</label>
            } @empty { <span>No available values</span> }
          </fieldset>
        </details>
      }
      <label
        >Received from<input
          aria-label="Received from"
          type="date"
          name="receivedFrom"
          [(ngModel)]="receivedFrom"
          [max]="receivedTo || '9999-12-31'"
      /></label>
      <label
        >Received to<input
          aria-label="Received to"
          type="date"
          name="receivedTo"
          [(ngModel)]="receivedTo"
          [min]="receivedFrom || '0001-01-01'"
      /></label>
      <button class="apply" type="submit">Apply filters</button
      ><mui-button variant="ghost" (pressed)="reset()">Clear filters</mui-button>
    </form>
    @if (activeFilters().length) {
      <div class="filter-chips" aria-label="Active filters">
        @for (filter of activeFilters(); track filter.key + ':' + filter.value) {
          <button type="button" (click)="removeFilter(filter.key, filter.value)"
            [attr.aria-label]="'Remove ' + filter.label + ' filter: ' + filter.value">{{ filter.label }}: {{ filter.value }} <span aria-hidden="true">×</span></button>
        }
      </div>
    }
    @if (filterError()) {
      <p class="error" role="alert">{{ filterError() }}</p>
    }
    <p class="snapshot" role="status">
      {{ total() }} sources in this snapshot
      @if (asOf()) {
        · {{ sourceDate(asOf()) | date: "shortTime" }}
      }
      @if (loading()) {
        · Loading…
      }
    </p>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (newEntries()) {
      <div class="arrival-notice" role="status">New entries available. Your current rows have not moved.
        <mui-button variant="ghost" [disabled]="loading()" (pressed)="refresh()">Show new entries</mui-button>
      </div>
    }
    @if (arrivalError()) { <p role="status">{{ arrivalError() }}</p> }
    @if (capped()) {
      <p role="status">
        This query reached the result limit. Narrow your filters to see more
        matches.
      </p>
    }
    <div class="table-wrap" tabindex="0" role="region" aria-label="Source observations — scroll horizontally for all columns">
      <table>
        <caption class="sr-only">
          Ingested source observations and their current processing state
        </caption>
        <thead>
          <tr>
            <th scope="col">Entity</th>
            <th scope="col">Type</th>
            <th scope="col">Source / account</th>
            <th scope="col">Observed state</th>
            <th scope="col">Processing state</th>
            <th scope="col">Classification</th>
            <th scope="col">Further analysis</th>
            <th scope="col">In notes</th>
            <th scope="col">Received</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.id) {
            <tr [class.selected]="selected() === row.id">
              <td>
                <button type="button" class="entity" (click)="inspect(row.id)">
                  <strong>{{
                    row.subject || row.sender || "Untitled observation"
                  }}</strong
                  ><span>{{ row.sender }}</span
                  ><small>{{ row.preview }}</small>
                </button>
              </td>
              <td>{{ row.type }}</td>
              <td>
                {{ row.connector }}<small>{{ row.account || "Local" }}</small>
              </td>
              <td>{{ row.observedState || "—" }}</td>
              <td>
                <span class="state" [class.failed]="row.status === 'failed'">{{
                  row.status
                }}</span
                ><small>{{ row.statusDetail }}</small>
              </td>
              <td>{{ row.classificationState || 'Not requested' }}
                <small>{{ row.classificationProvider ? 'Last recorded: ' + row.classificationProvider : 'Provider not recorded' }}</small>
                @if (row.classificationModel) { <small>{{ row.classificationModel }}</small> }
              </td>
              <td>{{ row.analysisState || 'Not requested' }}
                @if (row.analysisBranches?.length) {
                  <details><summary>Inspect branches</summary>
                    @for (branch of row.analysisBranches; track branch.stage) {
                      <small>{{ branch.stage }}: {{ branch.state }} · {{ branch.provider ? 'Last recorded: ' + branch.provider : 'Provider not recorded' }}</small>
                    }
                  </details>
                }
              </td>
              <td>
                <button class="table-action" type="button" (click)="inspect(row.id)"
                  [attr.aria-label]="'Inspect linked notes for ' + (row.subject || row.sender)">{{ row.noteCount === undefined ? 'Inspect links' : row.noteCount + (row.noteCount === 1 ? ' note' : ' notes') }}</button>
                <button class="table-action" type="button" (click)="addToToday(row.id)"
                  [attr.aria-label]="'Add to Today: ' + (row.subject || row.sender)">Add to Today</button>
              </td>
              <td>{{ sourceDate(row.receivedAt) | date: "MMM d, h:mm a" }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="9">
                {{
                  loading()
                    ? "Loading sources…"
                    : "No sources match these filters. Connect a source or adjust your filters."
                }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (next()) {
      <mui-button variant="ghost" [disabled]="loading()" (pressed)="more()"
        >Load more sources</mui-button
      >
    }
    @if (selected(); as eventID) {
      <maple-source-detail
        [eventID]="eventID"
        [allowInsert]="true"
        (closed)="close()"
        (inserted)="addToToday($event)"
      />
    }
  </section>`,
  styles: [
    `
      :host {
        display: block;
      }
      .sources-page {
        max-width: 1400px;
        margin: auto;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: center;
      }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin: 12px 0;
      }
      h1 {
        font: 48px/1.2 var(--font-serif);
        margin: 16px 0;
      }
      .intro {
        color: var(--color-text-muted);
        font-size: 16px;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
        padding: 24px 0;
      }
      .filters label {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
        color: var(--color-text-muted);
      }
      input,
      select,
      .apply {
        font: 14px var(--font-sans);
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-secondary);
        color: var(--color-text-main);
        min-height: 42px;
      }
      input[type="search"] {
        min-width: 230px;
      }
      input[type="date"] {
        width: 145px;
        min-width: 0;
      }
      .apply {
        background: var(--color-primary);
        color: var(--color-on-primary);
        cursor: pointer;
      }
      .snapshot {
        font-size: 12px;
        color: var(--color-text-muted);
        margin: 12px 0 20px;
      }
      .table-wrap {
        overflow: auto;
        border: 1px solid var(--color-border);
        border-radius: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 13px;
        min-width: 1360px;
      }
      th {
        font-weight: 500;
        color: var(--color-text-muted);
        padding: 14px 18px;
        background: var(--color-bg-secondary);
      }
      td {
        padding: 16px 18px;
        border-top: 1px solid var(--color-border);
        vertical-align: top;
      }
      td:first-child {
        width: 24%;
        min-width:240px;
      }
      small {
        display: block;
        font-size: 12px;
        color: var(--color-text-muted);
        margin-top: 6px;
        line-height: 1.5;
      }
      .entity {
        border: 0;
        background: none;
        color: var(--color-text-main);
        text-align: left;
        padding: 0;
        font: inherit;
        cursor: pointer;
        width: 100%;
      }
      .entity strong {
        display: block;
        font-size: 15px;
        margin-bottom: 7px;
        font-weight: 500;
      }
      .entity span {
        color: var(--color-text-muted);
      }
      .entity small {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .state {
        color: var(--color-link, var(--color-primary));
        display: inline-block;
        padding: 3px 8px;
        background: var(--color-primary-light);
        border-radius: 4px;
      }
      .state.failed {
        color: var(--color-danger);
      }
      tr.selected {
        background: var(--color-bg-secondary);
      }
      .table-wrap:focus-visible,
      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
        outline-offset: 2px;
      }
      .arrival-notice { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px; border:1px solid var(--color-border); border-radius:8px; margin-bottom:16px; }
      td:nth-child(3) { min-width:120px; }
      td:nth-child(6),td:nth-child(7) { min-width:145px; }
      td:nth-child(8) { min-width:105px; }
      td:nth-child(9) { min-width:110px; }
      .table-action { display:block; border:0; background:transparent; color:var(--color-link,var(--color-primary)); text-decoration:underline; font:inherit; padding:4px 0; cursor:pointer; text-align:left; }
      thead th { position:sticky; top:0; z-index:1; }
      .table-wrap { max-height:70dvh; }
      .filter-options { position:relative; min-width:140px; align-self:start; border:1px solid var(--color-border); border-radius:6px; background:var(--color-bg); }
      .filter-options summary { padding:10px; cursor:pointer; font-size:13px; }
      .filter-options fieldset { border:0; padding:8px 10px; margin:0; max-height:200px; overflow:auto; }
      .filters .filter-choice { display:flex; align-items:center; gap:8px; padding:5px 0; flex-direction:row; }
      .filter-choice input { min-width:0; min-height:0; width:16px; height:16px; padding:0; accent-color:var(--color-primary); }
      .filter-chips { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
      .filter-chips button { font:inherit; font-size:12px; border:1px solid var(--color-border); border-radius:16px; padding:5px 10px; color:var(--color-text-main); background:var(--color-bg-secondary); cursor:pointer; }
      summary:focus-visible { outline:2px solid var(--color-focus); outline-offset:2px; }
      .error {
        color: var(--color-danger);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
    `,
  ],
})
export class SourcesComponent implements OnInit, OnDestroy {
  readonly sourceDate = sourceDate;
  readonly service = inject(SourcesService);
  readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly today = inject(TodayDocumentService);
  readonly rows = signal<SourceRow[]>([]);
  readonly total = signal(0);
  readonly asOf = signal<string | number>("");
  readonly loading = signal(false);
  readonly error = signal("");
  readonly next = signal<SourceCursor | undefined>(undefined);
  readonly capped = signal(false);
  readonly newEntries = signal(false);
  readonly arrivalError = signal('');
  private snapshotCursor?: SourceCursor;
  private arrivalTimer?: ReturnType<typeof setInterval>;
  private checkingArrivals = false;
  readonly selected = signal<string | null>(null);
  readonly facets = signal<SourcePage["facets"]>({
    types: [],
    connectors: [],
    accounts: [],
    states: [],
  });
  search = "";
  type: string[] = [];
  connector: string[] = [];
  account: string[] = [];
  state: string[] = [];
  readonly dimensions = [
    { key: 'type', facet: 'types', label: 'Type' },
    { key: 'connector', facet: 'connectors', label: 'Source' },
    { key: 'account', facet: 'accounts', label: 'Account' },
    { key: 'state', facet: 'states', label: 'Processing' },
  ] as const;
  readonly activeFilters = signal<{key: string; label: string; value: string}[]>([]);
  private queryKey = '';
  receivedFrom = "";
  receivedTo = "";
  readonly filterError = signal("");
  private query = emptySourceQuery();
  private generation = 0;
  private subscriptions = new Subscription();
  ngOnInit() {
    this.arrivalTimer = setInterval(() => { if (!document.hidden) void this.checkArrivals(); }, 15_000);
    this.subscriptions.add(
      this.route.paramMap.subscribe((params) =>
        this.selected.set(params.get("eventID")),
      ),
    );
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        this.search = this.service.searchText;
        this.type = params.getAll("type");
        this.connector = params.has("source") ? params.getAll("source") : params.getAll("connector");
        this.account = params.getAll("account");
        this.state = params.getAll("state");
        this.receivedFrom = params.get("receivedFrom") ?? "";
        this.receivedTo = params.get("receivedTo") ?? "";
        const previous = this.queryKey;
        if (!this.updateQuery() || previous === this.queryKey) return;
        void this.refresh();
      }),
    );
  }
  ngOnDestroy() {
    this.generation++;
    this.subscriptions.unsubscribe();
    clearInterval(this.arrivalTimer);
    this.snapshotCursor = undefined;
  }
  apply() {
    this.service.searchText = this.search;
    if (!this.updateQuery()) return;
    void this.refresh();
    void this.router.navigate(["/sources"], {
      queryParams: {
        type: this.type.length ? this.type : undefined,
        source: this.connector.length ? this.connector : undefined,
        account: this.account.length ? this.account : undefined,
        state: this.state.length ? this.state : undefined,
        receivedFrom: this.receivedFrom || undefined,
        receivedTo: this.receivedTo || undefined,
      },
    });
  }
  toggleFilter(key: 'type' | 'connector' | 'account' | 'state', value: string) {
    this[key] = this[key].includes(value) ? this[key].filter(item => item !== value) : [...this[key], value];
  }
  removeFilter(key: string, value: string) {
    // Start from the applied query, so removing a chip does not apply unrelated draft controls.
    this.type = [...this.query.types]; this.connector = [...this.query.connectors];
    this.account = [...this.query.accounts]; this.state = [...this.query.states];
    const chips = this.activeFilters();
    this.search = this.query.text ?? '';
    this.receivedFrom = chips.find(chip => chip.key === 'receivedFrom')?.value ?? '';
    this.receivedTo = chips.find(chip => chip.key === 'receivedTo')?.value ?? '';
    if (key === 'type' || key === 'connector' || key === 'account' || key === 'state') this[key] = this[key].filter(item => item !== value);
    else if (key === 'search' || key === 'receivedFrom' || key === 'receivedTo') this[key] = '';
    this.apply();
  }
  reset() {
    this.type = []; this.connector = []; this.account = []; this.state = [];
    this.search = this.receivedFrom = this.receivedTo = '';
    this.apply();
  }
  private updateQuery(): boolean {
    try {
      this.query = buildSourceQuery(this);
      this.queryKey = JSON.stringify(this.query);
      this.activeFilters.set([
        ...this.dimensions.flatMap(dimension => this.query[dimension.facet].map(value => ({ key: dimension.key, label: dimension.label, value }))),
        ...([{ key: 'search', label: 'Search', value: this.query.text ?? '' },
          { key: 'receivedFrom', label: 'From', value: this.receivedFrom },
          { key: 'receivedTo', label: 'To', value: this.receivedTo }].filter(chip => chip.value)),
      ]);
      this.filterError.set("");
      return true;
    } catch (error) {
      this.generation++;
      this.loading.set(false);
      this.rows.set([]);
      this.total.set(0);
      this.next.set(undefined);
      this.filterError.set(
        error instanceof Error ? error.message : "Received dates are invalid.",
      );
      return false;
    }
  }
  async refresh() {
    if (this.filterError()) return;
    this.generation++;
    this.rows.set([]);
    this.next.set(undefined);
    this.snapshotCursor = undefined; this.newEntries.set(false); this.arrivalError.set('');
    await this.page(true);
  }
  async checkArrivals() {
    const cursor = this.snapshotCursor, generation = this.generation;
    if (!cursor || this.loading() || this.filterError() || this.newEntries() || this.checkingArrivals) return;
    this.checkingArrivals = true;
    try {
      const result = await this.service.changes(this.query, cursor);
      if (generation !== this.generation) return;
      this.newEntries.set(result.hasNewEntries); this.arrivalError.set('');
    } catch {
      if (generation === this.generation) this.arrivalError.set('New-entry check unavailable. Refresh to start a new snapshot; current rows remain available.');
    } finally { this.checkingArrivals = false; }
  }
  more() {
    return this.page(false);
  }
  private async page(replace: boolean) {
    if (!replace && (this.loading() || !this.next())) return;
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set("");
    try {
      const page = await this.service.list(
        this.query,
        replace ? undefined : this.next(),
      );
      if (generation !== this.generation) return;
      this.rows.set(replace ? page.items : [...this.rows(), ...page.items]);
      this.total.set(page.total);
      this.asOf.set(page.asOf);
      this.facets.set(page.facets);
      this.next.set(page.nextCursor);
      this.capped.set(page.hasMoreMatches);
      this.snapshotCursor = page.snapshotCursor;
    } catch (e) {
      if (generation === this.generation)
        this.error.set(
          e instanceof Error
            ? e.message
            : "Sources could not be loaded. Refresh to start a new snapshot.",
        );
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  inspect(eventID: string) {
    void this.router.navigate(["/sources", eventID], {
      queryParamsHandling: "preserve",
    });
  }
  close() {
    void this.router.navigate(["/sources"], {
      queryParamsHandling: "preserve",
    });
  }
  addToToday(eventID: string) {
    this.today.pendingSource.set(eventID);
    void this.router.navigate(["/today"]);
  }
}
