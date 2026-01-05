import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard } from './guards/auth.guard';
import { WriteNoteGuard, LegoNoteGuard } from './guards/note-type.guard';

export const routes: Routes = [
  // Settings route - must come before the home route
  {
    path: 'settings',
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'bots',
        loadComponent: () => import('./pages/bots/bots.component').then((m) => m.BotsComponent),
      },
    ],
  },
  // Notifications route
  {
    path: 'notifications',
    loadComponent: () =>
      import('./pages/notifications/notifications.component').then((m) => m.NotificationsComponent),
    canActivate: [AuthGuard],
  },
  // Authenticated app routes - matched first if user is authenticated
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AuthGuard],
    children: [
      // Tag routes - all routes with :tagId are nested under the tag component
      {
        path: ':tagId',
        loadComponent: () => import('./pages/tag/tag.component').then((m) => m.TagComponent),
        children: [
          // Tag view - shows chat/messages for the tag (default child route)
          {
            path: '',
            loadComponent: () =>
              import('./pages/chat-view/chat-view.component').then((m) => m.ChatViewComponent),
          },
          // Lego scan route
          {
            path: 'scan',
            loadComponent: () =>
              import('./pages/lego-scan/lego-scan.component').then((m) => m.LegoScanComponent),
          },
          // Collectible registry view
          {
            path: 'collectible/:collectibleId',
            loadComponent: () =>
              import('./pages/collectible-registry-view/collectible-registry-view.component').then(
                (m) => m.CollectibleRegistryViewComponent,
              ),
          },
          // Lego-type note - shows lego view
          {
            path: ':documentId',
            canMatch: [LegoNoteGuard],
            loadComponent: () =>
              import('./pages/lego-view/lego-view.component').then((m) => m.LegoViewComponent),
          },
          // Write-type note (default) - shows note editor
          {
            path: ':documentId',
            loadComponent: () =>
              import('./pages/write/write.component').then((m) => m.WriteComponent),
          },
        ],
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
