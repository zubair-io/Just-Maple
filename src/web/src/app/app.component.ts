import { CompanionComponent, isCompanion } from "./companion/companion.component";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { Router, RouterOutlet, NavigationEnd } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import {
  MuiAppShellComponent,
  MuiSidebarComponent,
  MuiSidebarSection,
  MuiButtonComponent,
} from "@maple/ui";
import { NativeBridge } from "./core/native-bridge.service";
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly companion = isCompanion();
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
    { initialValue: "overview" },
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
        { id: "history", label: "History", icon: "history" },
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
  constructor() {
    if (!this.companion) this.bridge.start();
  }
  navigate(id: string | null) {
    if (id !== null) void this.router.navigateByUrl("/" + id);
  }
  step(id: string | null) {
    if (id !== null && (Number(id) <= 1 || this.s().name))
      void this.bridge.act({ action: "step", value: Number(id) });
  }
}
