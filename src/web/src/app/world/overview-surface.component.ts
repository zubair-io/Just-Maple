import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
export interface OverviewState {property:string;status:string;value?:string}
export interface OverviewActivity {id:string;name:string;detail:string;openTaskCount:number}
/** Shared Mac/iPhone overview. Hosts provide data and navigation; this surface owns the layout. */
@Component({
  selector:'maple-overview-surface',standalone:true,imports:[MuiButtonComponent],changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
    <div class="eyebrow">Your world / now</div>
    <h1>{{ greeting() }}{{ name() ? ', ' + name() : '' }}.</h1>
    <p>Here’s what is true, what needs your attention, and what’s moving forward.</p>
    <div class="section-label">Right now</div>
    <section class="right-now">
      <div class="state-sentence">@for (state of states(); track state.property) {
        @if (inspectable()) {<mui-button variant="ghost" (pressed)="stateSelected.emit(state.property)">{{ state.value || ('Review ' + state.property + ' evidence') }}</mui-button>}
        @else {<span class="state-value">{{ state.value || ('Review ' + state.property + ' evidence') }}</span>}
      } @empty {<h3>No current state has enough evidence yet.</h3><p>Location and availability need fresh evidence; past messages alone do not establish them.</p>}</div>
      <ng-content select="[schedule]" />
      @if (inspectable()) {<mui-button variant="ghost" (pressed)="inspectState.emit()">Inspect my state →</mui-button>}
    </section>
    <div class="row section-heading"><div class="section-label">Needs you</div>
      <mui-button variant="ghost" (pressed)="viewTasks.emit()">View all Needs you · {{ total() }} →</mui-button></div>
    <ng-content select="[attention]" />
    @if (waiting() > 0) {<div class="waiting-summary"><mui-button variant="ghost" (pressed)="viewWaiting.emit()">Waiting · {{ waiting() }} · View tasks →</mui-button></div>}
    <div class="row section-heading"><div class="section-label">Activities</div><mui-button variant="ghost" (pressed)="viewActivities.emit()">View all activities →</mui-button></div>
    <div class="activity-grid">@for (activity of activities().slice(0,6); track activity.id) {
      <button class="activity-card" (click)="activitySelected.emit(activity.id)"><h3>{{ activity.name }}</h3><p>{{ activity.detail }} · {{ activity.openTaskCount }} open tasks</p></button>
    } @empty {<section class="quiet-state"><h3>Your world starts with what matters to you.</h3><p>Activities appear as Maple learns what connects your sources.</p><ng-content select="[emptyActivities]" /></section>}</div>
    <ng-content />`,
  styles:[`:host{display:block;max-width:1000px;margin:auto}.eyebrow{margin-bottom:24px}h1{font-size:32px;letter-spacing:-.04em}.section-heading{margin:20px 0 10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center}.section-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--color-text-muted)}.right-now{margin:8px 0 20px;padding:16px 20px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-secondary)}.state-sentence{display:flex;gap:12px;flex-wrap:wrap}.state-value{font-size:18px}.activity-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.activity-card{padding:16px;min-height:76px;text-align:left;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-secondary);color:var(--color-text-main);font:inherit;cursor:pointer}.activity-card h3{font-size:16px;margin:0 0 8px}.activity-card p{font-size:13px;margin:0;color:var(--color-text-muted)}button:focus-visible{outline:2px solid var(--color-primary)}@media(max-width:600px){h1{font-size:28px}.activity-grid{grid-template-columns:1fr 1fr}.activity-card{padding:12px;overflow-wrap:anywhere}}`]
})
export class OverviewSurfaceComponent {
  readonly name=input('');readonly greeting=input('Your overview');readonly states=input<OverviewState[]>([]);readonly activities=input<OverviewActivity[]>([]);readonly total=input(0);readonly waiting=input(0);readonly inspectable=input(true);
  readonly stateSelected=output<string>();readonly inspectState=output<void>();readonly viewTasks=output<void>();readonly viewWaiting=output<void>();readonly viewActivities=output<void>();readonly activitySelected=output<string>();
}
