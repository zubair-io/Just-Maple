import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard } from './guards/auth.guard';
import {
  CollectablePageGuard,
  WhiteboardPageGuard,
  KanbanPageGuard,
  MemoPageGuard,
  MessagePageGuard,
  GmailPageGuard,
  JsonPageGuard,
} from './guards/page-type.guard';
import { swUpdateGuard } from './guards/sw-update.guard';

export const routes: Routes = [
  // Auth routes - must come before the catch-all :notebookId route
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [swUpdateGuard, PublicGuard],
  },
  {
    path: 'verify',
    loadComponent: () => import('./pages/verify/verify.component').then((m) => m.VerifyComponent),
    canActivate: [swUpdateGuard],
  },

  // Gmail OAuth callback - public route, no auth required
  {
    path: 'gmail/oauth/callback',
    loadComponent: () =>
      import('./pages/gmail-oauth-callback/gmail-oauth-callback.component').then(
        (m) => m.GmailOAuthCallbackComponent,
      ),
  },

  // Authenticated app routes - matched first if user is authenticated
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AuthGuard],
    canActivateChild: [swUpdateGuard],
    children: [
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
          import('./pages/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
        canActivate: [AuthGuard],
      },
      // Tag routes - all routes with :notebookId are nested under the tag component
      {
        path: ':notebookId',
        loadComponent: () =>
          import('./pages/notebook-layout/notebook-layout.component').then(
            (m) => m.NotebookLayoutComponent,
          ),
        children: [
          // Tag view - shows chat/messages for the tag (default child route)
          {
            path: '',
            loadComponent: () =>
              import('./pages/chat-view/chat-view.component').then((m) => m.ChatViewComponent),
          },
          // Create new note route
          {
            path: 'new',
            loadComponent: () =>
              import('./pages/new-note/new-note.component').then((m) => m.NewNoteComponent),
          },
          // Lego scan route
          {
            path: 'scan',
            loadComponent: () =>
              import('./pages/lego-scan/lego-scan.component').then((m) => m.LegoScanComponent),
          },
          // Todos view route
          {
            path: 'todos',
            loadComponent: () =>
              import('./pages/todos-view/todos-view.component').then((m) => m.TodosViewComponent),
          },
          // Collectible registry view
          {
            path: 'collectible/:collectibleId',
            loadComponent: () =>
              import('./pages/collectible-registry-view/collectible-registry-view.component').then(
                (m) => m.CollectibleRegistryViewComponent,
              ),
          },
          // Kanban card memo route - opens modal over kanban board
          {
            path: ':id/:memoId',
            canMatch: [KanbanPageGuard],
            loadComponent: () =>
              import('./pages/kanban-view/kanban-view.component').then(
                (m) => m.KanbanViewComponent,
              ),
          },
          // Collectable-type page - shows collectable view
          {
            path: ':id',
            canMatch: [CollectablePageGuard],
            loadComponent: () =>
              import('./pages/lego-view/lego-view.component').then((m) => m.LegoViewComponent),
          },
          // Whiteboard-type page - shows collaborative whiteboard
          {
            path: ':id',
            canMatch: [WhiteboardPageGuard],
            loadComponent: () =>
              import('./pages/whiteboard-view/whiteboard-view.component').then(
                (m) => m.WhiteboardViewComponent,
              ),
          },
          // Message-type page - shows chat/messages
          {
            path: ':id',
            canMatch: [MessagePageGuard],
            loadComponent: () =>
              import('./pages/message-view/message-view.component').then(
                (m) => m.MessageViewComponent,
              ),
          },
          // Kanban-type page - shows kanban board
          {
            path: ':id',
            canMatch: [KanbanPageGuard],
            loadComponent: () =>
              import('./pages/kanban-view/kanban-view.component').then(
                (m) => m.KanbanViewComponent,
              ),
          },
          // Gmail-type page - shows email integration (owner-only)
          {
            path: ':id',
            canMatch: [GmailPageGuard],
            loadComponent: () =>
              import('./pages/gmail-view/gmail-view.component').then((m) => m.GmailViewComponent),
          },
          // JSON-type page - shows JSON data editor (code + form)
          {
            path: ':id',
            canMatch: [JsonPageGuard],
            loadComponent: () =>
              import('./pages/json-view/json-view.component').then((m) => m.JsonViewComponent),
          },
          // Memo-type page - shows collaborative notebook editor (default for pages)
          {
            path: ':id',
            canMatch: [MemoPageGuard],
            loadComponent: () =>
              import('./pages/notebook/notebook.component').then((m) => m.NotebookComponent),
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
    canActivate: [swUpdateGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
