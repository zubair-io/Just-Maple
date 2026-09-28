import {
  CompanionComponent,
  isCompanion,
} from "./companion/companion.component";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
} from "@angular/core";
import {
  Router,
  RouterOutlet,
  NavigationEnd,
  NavigationStart,
} from "@angular/router";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import {
  MuiAppShellComponent,
  MuiSidebarComponent,
  MuiSidebarSection,
  MuiButtonComponent,
} from "@maple/ui";
import { NativeBridge } from "./core/native-bridge.service";
import { TodayDocumentService } from "./today/today-document.service";
import { NotebookService } from "./notebooks/notebook.service";
import { LocalCalendar } from "./core/local-calendar.service";
import { offsetDay } from "./daily-note/daily-note.models";
import { OnboardingComponent } from "./pages/onboarding.component";
@Component({
  selector: "maple-root",
  standalone: true,
  imports: [
    CompanionComponent,
    RouterOutlet,
    MuiAppShellComponent,
    MuiSidebarComponent,
    MuiButtonComponent,
    OnboardingComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly companion = isCompanion();
  readonly daily = inject(TodayDocumentService);
  readonly notebooks = inject(NotebookService);
  readonly calendar = inject(LocalCalendar);
  readonly days = computed(() => [
    {
      label: "Yesterday",
      offset: -1,
      day: offsetDay(this.calendar.today(), -1),
    },
    { label: "Today", offset: 0, day: this.calendar.today() },
    { label: "Tomorrow", offset: 1, day: offsetDay(this.calendar.today(), 1) },
  ]);
  readonly bridge = inject(NativeBridge);
  readonly s = this.bridge.state;
  readonly router = inject(Router);
  readonly active = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(
        (e) =>
          (e as NavigationEnd).urlAfterRedirects.split("?")[0].split("/")[1],
      ),
    ),
    { initialValue: "today" },
  );
  readonly sections: MuiSidebarSection[] = [
    {
      id: "primary",
      label: "",
      nodes: [
        { id: "overview", label: "Overview", icon: "grid-lg" },
        { id: "tasks", label: "Tasks", icon: "check" },
        { id: "activities", label: "Activities", icon: "scope" },
      ],
    },
    {
      id: "world",
      label: "YOUR WORLD",
      nodes: [
        { id: "me", label: "Me", icon: "person-circle" },
        { id: "people", label: "People", icon: "heart" },
        { id: "home", label: "Home", icon: "folder" },
        { id: "work", label: "Work", icon: "inspector" },
        { id: "schedule", label: "Schedule", icon: "calendar" },
        { id: "health", label: "Health", icon: "heart" },
      ],
    },
    {
      id: "support",
      label: "",
      nodes: [
        { id: "sources", label: "Sources", icon: "history" },
        { id: "notebooks", label: "Notebooks", icon: "edit" },
        { id: "connections", label: "Connections", icon: "gear" },
      ],
    },
  ];
  readonly steps = computed<MuiSidebarSection[]>(() => [
    {
      id: "setup",
      label: "GETTING TO KNOW YOU",
      nodes: [
        "Hello",
        "About you",
        "Your starting point",
        "Review facts",
        "Your connections",
        "Your intelligence",
        "Your world",
      ].map((label, i) => ({ id: String(i), label: `${i + 1}. ${label}` })),
    },
  ]);
  private navigationIntent = 0;
  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.navigationIntent++);
    if (!this.companion) {
      this.bridge.start();
      void this.notebooks.refresh();
    }
  }
  async openDay(day: string | number) {
    const intent = ++this.navigationIntent;
    if (!(await this.daily.flush()) || intent !== this.navigationIntent) return;
    const target =
      typeof day === "number" ? offsetDay(this.calendar.refresh(), day) : day;
    await this.router.navigateByUrl("/today/" + target);
  }
  async openNotebook(id: string) {
    const intent = ++this.navigationIntent;
    if (!(await this.daily.flush()) || intent !== this.navigationIntent) return;
    await this.notebooks.selectBook(id);
    if (intent !== this.navigationIntent) return;
    await this.router.navigateByUrl("/notebooks");
  }
  navigate(id: string | null) {
    if (id !== null) {
      this.navigationIntent++;
      void this.router.navigateByUrl("/" + id);
    }
  }
  step(id: string | null) {
    if (id !== null && (Number(id) <= 1 || this.s().name))
      void this.bridge.act({ action: "step", value: Number(id) });
  }
}
