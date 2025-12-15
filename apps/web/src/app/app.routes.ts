import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard } from './guards/auth.guard';
import { LegoTagGuard, NotLegoTagGuard } from './guards/lego-tag.guard';

export const routes: Routes = [
  // Authenticated app routes - matched first if user is authenticated
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AuthGuard],
    children: [
      // Root - always note view
      {
        path: '',
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
      // Lego tag routes - matched first
      {
        path: ':tagId',
        canMatch: [LegoTagGuard],
        loadComponent: () =>
          import('./pages/lego-view/lego-view.component').then((m) => m.LegoViewComponent),
      },
      {
        path: ':tagId/:registryId',
        canMatch: [LegoTagGuard],
        loadComponent: () =>
          import('./pages/collectible-registry-view/collectible-registry-view.component').then(
            (m) => m.CollectibleRegistryViewComponent,
          ),
      },
      // Regular note routes - fallback
      {
        path: ':tagId',
        canMatch: [NotLegoTagGuard],
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
      {
        path: ':tagId/:noteId',
        canMatch: [NotLegoTagGuard],
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
