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
  RouterLink,
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
    RouterLink,
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
      route: "/yesterday",
      day: offsetDay(this.calendar.today(), -1),
    },
    { label: "Today", route: "/today", day: this.calendar.today() },
    {
      label: "Tomorrow",
      route: "/tomorrow",
      day: offsetDay(this.calendar.today(), 1),
    },
  ]);
  readonly bridge = inject(NativeBridge);
  readonly s = this.bridge.state;
  readonly router = inject(Router);
  readonly activePath = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects.split(/[?#]/)[0]),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] },
  );
  readonly active = computed(() => this.activePath().split("/")[1]);
  readonly dailyWorkspace = computed(() => this.s().loaded && this.s().step < 0 && ["today", "yesterday", "tomorrow", "daily", "notebooks"].includes(this.active() ?? ""));
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
  async openNotebook(id: string, path?: string) {
    const intent = ++this.navigationIntent;
    if (!(await this.daily.flush()) || intent !== this.navigationIntent) return;
    if (!path || this.notebooks.bookID() !== id) await this.notebooks.selectBook(id);
    if (intent !== this.navigationIntent) return;
    if (path) {
      if (this.notebooks.bookID() !== id) return;
      await this.notebooks.open(path);
      if (intent !== this.navigationIntent || this.notebooks.document()?.notebookID !== id || this.notebooks.document()?.path !== path) return;
    }
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
