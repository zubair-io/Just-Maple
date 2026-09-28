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
      <label
        >Type<select aria-label="Type" name="type" [(ngModel)]="type">
          <option value="">All types</option>
          @for (value of facets().types; track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select></label
      >
      <label
        >Source<select
          aria-label="Source"
          name="connector"
          [(ngModel)]="connector"
        >
          <option value="">All sources</option>
          @for (value of facets().connectors; track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select></label
      >
      <label
        >Account<select
          aria-label="Account"
          name="account"
          [(ngModel)]="account"
        >
          <option value="">All accounts</option>
          @for (value of facets().accounts; track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select></label
      >
      <label
        >Processing<select
          aria-label="Processing"
          name="state"
          [(ngModel)]="state"
        >
          <option value="">All states</option>
          @for (value of facets().states; track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select></label
      >
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
      ><mui-button variant="ghost" (pressed)="reset()">Reset</mui-button>
    </form>
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
    @if (capped()) {
      <p role="status">
        This query reached the result limit. Narrow your filters to see more
        matches.
      </p>
    }
    <div class="table-wrap">
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
                @if (row.classificationState) {
                  <small>Classification: {{ row.classificationState }}</small>
                }
                @if (row.analysisState) {
                  <small>Downstream AI: {{ row.analysisState }}</small>
                }
              </td>
              <td>{{ sourceDate(row.receivedAt) | date: "MMM d, h:mm a" }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6">
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
        min-width: 760px;
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
        width: 36%;
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
      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
        outline-offset: 2px;
      }
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
  readonly selected = signal<string | null>(null);
  readonly facets = signal<SourcePage["facets"]>({
    types: [],
    connectors: [],
    accounts: [],
    states: [],
  });
  search = "";
  type = "";
  connector = "";
  account = "";
  state = "";
  receivedFrom = "";
  receivedTo = "";
  readonly filterError = signal("");
  private query = emptySourceQuery();
  private generation = 0;
  private subscriptions = new Subscription();
  ngOnInit() {
    this.subscriptions.add(
      this.route.paramMap.subscribe((params) =>
        this.selected.set(params.get("eventID")),
      ),
    );
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        this.search = this.service.searchText;
        this.type = params.get("type") ?? "";
        this.connector = params.get("source") ?? params.get("connector") ?? "";
        this.account = params.get("account") ?? "";
        this.state = params.get("state") ?? "";
        this.receivedFrom = params.get("receivedFrom") ?? "";
        this.receivedTo = params.get("receivedTo") ?? "";
        if (!this.updateQuery()) return;
        void this.refresh();
      }),
    );
  }
  ngOnDestroy() {
    this.generation++;
    this.subscriptions.unsubscribe();
  }
  apply() {
    this.service.searchText = this.search;
    if (!this.updateQuery()) return;
    void this.refresh();
    void this.router.navigate(["/sources"], {
      queryParams: {
        type: this.type || undefined,
        source: this.connector || undefined,
        account: this.account || undefined,
        state: this.state || undefined,
        receivedFrom: this.receivedFrom || undefined,
        receivedTo: this.receivedTo || undefined,
      },
    });
  }
  reset() {
    this.search =
      this.type =
      this.connector =
      this.account =
      this.state =
      this.receivedFrom =
      this.receivedTo =
        "";
    this.apply();
  }
  private updateQuery(): boolean {
    try {
      this.query = buildSourceQuery(this);
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
    await this.page(true);
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
