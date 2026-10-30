import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'atoms',
    loadComponent: () =>
      import('./pages/atoms-showcase/atoms-showcase.component').then(
        (m) => m.AtomsShowcaseComponent,
      ),
  },
  {
    path: '',
    loadComponent: () => import('./layouts/home/home.component').then((m) => m.HomeComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/welcome/welcome.component').then((m) => m.WelcomeComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: ':folderId',
        loadComponent: () =>
          import('./pages/folder-layout/folder-layout.component').then(
            (m) => m.FolderLayoutComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/welcome/welcome.component').then((m) => m.WelcomeComponent),
          },
          {
            path: 'new',
            loadComponent: () =>
              import('./pages/new-note/new-note.component').then((m) => m.NewNoteComponent),
          },
          {
            path: 'todos',
            loadComponent: () =>
              import('./pages/todos-view/todos-view.component').then((m) => m.TodosViewComponent),
          },
          {
            path: ':id',
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
