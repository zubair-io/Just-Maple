import { inject } from "@angular/core";
import { Router, Routes } from "@angular/router";
import { localDay, offsetDay } from "../daily-note/daily-note.models";
import { TodayComponent } from "./today.component";
import { validDay } from "./today-document.service";

export const todayRedirect = () => "/daily/" + localDay();

/** Relative routes resolve on navigation; only the dated route hosts an editor. */
export const dailyRoutes: Routes = [
  ...(
    [
      ["today", 0],
      ["yesterday", -1],
      ["tomorrow", 1],
    ] as const
  ).map(([path, offset]) => ({
    path,
    pathMatch: "full" as const,
    redirectTo: () => "/daily/" + offsetDay(localDay(), offset),
  })),
  {
    path: "today/:date",
    redirectTo: ({ params }) => "/daily/" + params["date"],
  },
  { path: "daily", pathMatch: "full", redirectTo: todayRedirect },
  {
    path: "daily/:date",
    component: TodayComponent,
    canActivate: [
      (route) =>
        validDay(route.params["date"]) || inject(Router).parseUrl("/today"),
    ],
    canDeactivate: [(component: TodayComponent) => component.notes.flush()],
  },
];
