import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard } from './guards/auth.guard';
import { WriteNoteGuard, LegoNoteGuard } from './guards/note-type.guard';

export const routes: Routes = [
  // Settings route - must come before the home route
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
    canActivate: [AuthGuard],
  },
  // Notifications route
  {
    path: 'notifications',
    loadComponent: () =>
      import('./pages/notifications/notifications.component').then((m) => m.NotificationsComponent),
    canActivate: [AuthGuard],
  },
  // Bots management route
  {
    path: 'bots',
    loadComponent: () => import('./pages/bots/bots.component').then((m) => m.BotsComponent),
    canActivate: [AuthGuard],
  },
  // Authenticated app routes - matched first if user is authenticated
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AuthGuard],
    children: [
      // Root - chat view (shows empty state prompting to select a folder)
      {
        path: '',
        loadComponent: () =>
          import('./pages/chat-view/chat-view.component').then((m) => m.ChatViewComponent),
      },
      // Lego scan route (direct access)
      {
        path: ':tagId/scan',
        loadComponent: () =>
          import('./pages/lego-scan/lego-scan.component').then((m) => m.LegoScanComponent),
      },
      // Collectible registry view
      {
        path: ':tagId/collectible/:collectibleId',
        loadComponent: () =>
          import('./pages/collectible-registry-view/collectible-registry-view.component').then(
            (m) => m.CollectibleRegistryViewComponent,
          ),
      },
      // Tag view - shows chat/messages for the tag
      {
        path: ':tagId',
        loadComponent: () =>
          import('./pages/chat-view/chat-view.component').then((m) => m.ChatViewComponent),
      },
      // Lego-type note - shows lego view
      {
        path: ':tagId/:noteId',
        canMatch: [LegoNoteGuard],
        loadComponent: () =>
          import('./pages/lego-view/lego-view.component').then((m) => m.LegoViewComponent),
      },
      // Write-type note (default) - shows note editor
      {
        path: ':tagId/:noteId',
        canMatch: [WriteNoteGuard],
        loadComponent: () =>
          import('./pages/note-view/note-view.component').then((m) => m.NoteViewComponent),
      },
      // Fallback for any note type - shows note view
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
