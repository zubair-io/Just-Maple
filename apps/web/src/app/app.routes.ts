import { Routes } from '@angular/router';
import { AuthGuard, PublicGuard, AppLayoutGuard } from './guards/auth.guard';
import { NotebookGuard } from './guards/notebook.guard';
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

  // Public notebook viewer - /!/notebook-slug/page-slug
  {
    path: '!/:notebookSlug',
    loadComponent: () =>
      import('./pages/public-notebook/public-notebook-layout.component').then(
        (m) => m.PublicNotebookLayoutComponent,
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/public-notebook/public-landing.component').then(
            (m) => m.PublicLandingComponent,
          ),
      },
      {
        path: ':pageSlug',
        loadComponent: () =>
          import('./pages/public-notebook/public-page.component').then(
            (m) => m.PublicPageComponent,
          ),
      },
    ],
  },

  // Notebook public redirect / unauthenticated access handler.
  // Intercepts /:notebookId(/:pageId) BEFORE the auth-protected routes.
  // The guard either redirects (public → /!/slug/slug, private+unauthed → /login)
  // or falls through (private+authed → handled by the auth root below).
  {
    path: ':notebookId',
    canMatch: [NotebookGuard],
    loadComponent: () =>
      import('./pages/notebook-layout/notebook-layout.component').then(
        (m) => m.NotebookLayoutComponent,
      ),
    children: [
      {
        path: '**',
        loadComponent: () =>
          import('./pages/notebook-layout/notebook-layout.component').then(
            (m) => m.NotebookLayoutComponent,
          ),
      },
    ],
  },

  // Main app layout - always matches after auth init.
  // HomeComponent gates cloud-only logic behind isAuthenticated().
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    canMatch: [AppLayoutGuard],
    canActivateChild: [swUpdateGuard],
    children: [
      // Default child - welcome/landing when no notebook is selected
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/welcome/welcome.component').then((m) => m.WelcomeComponent),
      },
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
  {
    path: '**',
    redirectTo: '',
  },
];
