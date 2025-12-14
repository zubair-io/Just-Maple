import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Authenticated app routes - matched first if user is authenticated
  {
    path: '',
    loadComponent: () =>
      import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AuthGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
      {
        path: ':tagId',
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
      {
        path: ':tagId/:noteId',
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
    ],
  },
  // Marketing page - fallback for unauthenticated users at '/'
  {
    path: '',
    loadComponent: () =>
      import('./pages/marketing/marketing.component').then((m) => m.MarketingComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [PublicGuard],
  },
  {
    path: 'verify',
    loadComponent: () => import('./pages/verify/verify.component').then((m) => m.VerifyComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
