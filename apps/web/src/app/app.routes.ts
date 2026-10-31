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
  CanvasPageGuard,
  AboutMePageGuard,
  GraphPageGuard,
  ActivityPageGuard,
  FollowUpsPageGuard,
} from './guards/page-type.guard';
import { swUpdateGuard } from './guards/sw-update.guard';
import {
  CalendarPageGuard,
  ContactsPageGuard,
  HealthPageGuard,
  HomePageGuard,
  IMessagePageGuard,
  MailPageGuard,
  PlacesPageGuard,
} from './guards/device-data-page.guard';

export const routes: Routes = [
  {
    path: 'atoms',
    loadComponent: () =>
      import('./pages/atoms-showcase/atoms-showcase.component').then(
        (m) => m.AtomsShowcaseComponent,
      ),
  },
  // Auth routes - must come before the catch-all :notebookId route
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [swUpdateGuard, PublicGuard],
  },
  {
    path: 'verify',
    redirectTo: 'login',
    pathMatch: 'full',
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
      {
        path: 'recorder',
        loadComponent: () =>
          import('./pages/recorder/recorder.component').then((m) => m.RecorderComponent),
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
          {
            path: 'devices',
            loadComponent: () =>
              import('./pages/devices/devices.component').then((m) => m.DevicesComponent),
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
      // Keep notebook navigation mounted while opening pages within the notebook.
      {
        path: ':notebookId',
        loadComponent: () =>
          import('./pages/chat-view/chat-view.component').then((m) => m.ChatViewComponent),
        children: [
          {
            path: 'today',
            loadComponent: () =>
              import('./pages/today-view/today-view.component').then((m) => m.TodayViewComponent),
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
          // Canvas-type page - AI-generated reactive widget canvas
          {
            path: ':id',
            canMatch: [CanvasPageGuard],
            loadComponent: () =>
              import('./pages/canvas-view/canvas-view.component').then(
                (m) => m.CanvasViewComponent,
              ),
          },
          // Device data pages - one source of the owner's device data each (owner-only data)
          {
            path: ':id',
            canMatch: [IMessagePageGuard],
            loadComponent: () =>
              import('./pages/imessage-view/imessage-view.component').then(
                (m) => m.IMessageViewComponent,
              ),
          },
          {
            path: ':id',
            canMatch: [MailPageGuard],
            loadComponent: () =>
              import('./pages/mail-view/mail-view.component').then((m) => m.MailViewComponent),
          },
          {
            path: ':id',
            canMatch: [CalendarPageGuard],
            loadComponent: () =>
              import('./pages/calendar-view/calendar-view.component').then(
                (m) => m.CalendarViewComponent,
              ),
          },
          {
            path: ':id',
            canMatch: [ContactsPageGuard],
            loadComponent: () =>
              import('./pages/contacts-view/contacts-view.component').then(
                (m) => m.ContactsViewComponent,
              ),
          },
          {
            path: ':id',
            canMatch: [PlacesPageGuard],
            loadComponent: () =>
              import('./pages/places-view/places-view.component').then(
                (m) => m.PlacesViewComponent,
              ),
          },
          {
            path: ':id',
            canMatch: [HealthPageGuard],
            loadComponent: () =>
              import('./pages/health-view/health-view.component').then(
                (m) => m.HealthViewComponent,
              ),
          },
          {
            path: ':id',
            canMatch: [HomePageGuard],
            loadComponent: () =>
              import('./pages/home-view/home-view.component').then((m) => m.HomeViewComponent),
          },
          // About me page - what bots know about each member (each sees only their own)
          {
            path: ':id',
            canMatch: [AboutMePageGuard],
            loadComponent: () =>
              import('./pages/about-me-view/about-me-view.component').then(
                (m) => m.AboutMeViewComponent,
              ),
          },
          // Graph page - links between what the notebook's data pages share
          {
            path: ':id',
            canMatch: [GraphPageGuard],
            loadComponent: () =>
              import('./pages/graph-view/graph-view.component').then((m) => m.GraphViewComponent),
          },
          // Activity page - what bots did and proposed in the notebook
          {
            path: ':id',
            canMatch: [ActivityPageGuard],
            loadComponent: () =>
              import('./pages/activity-view/activity-view.component').then(
                (m) => m.ActivityViewComponent,
              ),
          },
          // Follow-ups page - promises and replies owed, from the notebook's messages and mail
          {
            path: ':id',
            canMatch: [FollowUpsPageGuard],
            loadComponent: () =>
              import('./pages/follow-ups-view/follow-ups-view.component').then(
                (m) => m.FollowUpsViewComponent,
              ),
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
