import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withHashLocation } from "@angular/router";
import { dailyRoutes, todayRedirect } from "./app/today/daily.routes";
import { SourcesComponent } from "./app/sources/sources.component";
import { DailyNoteComponent } from "./app/daily-note/daily-note.component";
import { AppComponent } from "./app/app.component";
import { WorkspaceComponent } from "./app/pages/workspace.component";
import { OverviewComponent } from "./app/world/overview.component";
import { TasksComponent } from "./app/world/tasks.component";
import { TaskDetailComponent } from "./app/world/task-detail.component";
import { ActivitiesComponent } from "./app/world/activities.component";
import { StateComponent } from "./app/world/state.component";
import { SuggestionComponent } from "./app/world/suggestion.component";
import { NotebooksComponent } from "./app/notebooks/notebooks.component";
import { HistoryComponent } from "./app/world/history.component";
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(
      [
        ...dailyRoutes,
        {
          matcher: (segments) =>
            segments[0]?.path === "sources" && segments.length <= 2
              ? {
                  consumed: segments,
                  ...(segments[1]
                    ? { posParams: { eventID: segments[1] } }
                    : {}),
                }
              : null,
          component: SourcesComponent,
        },
        {
          path: "daily-legacy",
          component: DailyNoteComponent,
          canDeactivate: [
            (component: DailyNoteComponent) => component.notes.flush(),
          ],
        },
        { path: "overview", component: OverviewComponent },
        { path: "tasks", component: TasksComponent },
        { path: "tasks/:id", component: TaskDetailComponent },
        { path: "activities", component: ActivitiesComponent },
        { path: "activities/:id", component: ActivitiesComponent },
        { path: "suggestions/:id", component: SuggestionComponent },
        { path: "state/:subject/:property", component: StateComponent },
        ...["Me", "Home", "Work", "Health"].map((lens) => ({
          path: lens.toLowerCase(),
          component: StateComponent,
          data: { lens },
        })),
        { path: "history", redirectTo: "sources", pathMatch: "full" },
        {
          path: "notebooks",
          component: NotebooksComponent,
          canDeactivate: [
            (component: NotebooksComponent) => component.flush(),
          ],
        },
        ...[
          { path: "people", page: "People" },
          { path: "schedule", page: "Calendar" },
          { path: "connections", page: "Connections" },
          { path: "processing", page: "Activity" },
          { path: "search", page: "Search" },
          { path: "profile-evidence", page: "Me" },
        ].map((r) => ({
          ...r,
          component: WorkspaceComponent,
          data: { page: r.page },
        })),
        { path: "notes", redirectTo: "notebooks", pathMatch: "full" },
        { path: "calendar", redirectTo: "schedule", pathMatch: "full" },
        { path: "activity", redirectTo: "sources", pathMatch: "full" },
        { path: "", redirectTo: todayRedirect, pathMatch: "full" },
        { path: "**", redirectTo: todayRedirect },
      ],
      withHashLocation(),
    ),
  ],
}).catch(() => {
  document.body.textContent =
    "Just Maple could not load its interface. Rebuild the Angular bundle and try again.";
});
