import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FileSystemService } from '../../services/file-system.service';
import { AuthService } from '../../services/auth.service';

interface Feature {
  key: string;
  icon: string;
  label: string;
  description: string;
}

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  private readonly fsService = inject(FileSystemService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isFileSystemSupported = this.fsService.isSupported;
  readonly isAuthenticated = this.authService.isAuthenticated;
  readonly currentYear = new Date().getFullYear();

  readonly selectedFeature = signal<string | null>(null);

  readonly features: Feature[] = [
    {
      key: 'notes',
      icon: 'description',
      label: 'Rich notes',
      description:
        'A full-featured editor with headings, lists, checklists, tables, code blocks, and embedded media.',
    },
    {
      key: 'local',
      icon: 'folder_open',
      label: 'Local-first files',
      description:
        'Notes are stored as plain .maple.md files on your device. No account needed, no lock-in.',
    },
    {
      key: 'whiteboards',
      icon: 'draw',
      label: 'Whiteboards',
      description:
        'Infinite canvas for sketching diagrams, mind maps, and visual ideas with real-time collaboration.',
    },
    {
      key: 'kanban',
      icon: 'view_kanban',
      label: 'Kanban boards',
      description:
        'Organize projects with drag-and-drop columns and cards. Track progress at a glance.',
    },
    {
      key: 'todos',
      icon: 'check_box',
      label: 'Todos & priorities',
      description:
        'Inline task lists with priority levels, due dates, and color coding right inside your notes.',
    },
    {
      key: 'search',
      icon: 'search',
      label: '\u2318K search',
      description:
        'Instantly find any page by title or content across all your notebooks, local and cloud.',
    },
    {
      key: 'code',
      icon: 'code',
      label: 'Code blocks',
      description: 'Syntax-highlighted code blocks with language detection for over 100 languages.',
    },
    {
      key: 'images',
      icon: 'image',
      label: 'Image embeds',
      description:
        'Drag and drop images directly into your notes. Assets are stored alongside your files.',
    },
    {
      key: 'sync',
      icon: 'sync',
      label: 'Cloud sync',
      description: 'Sign in to sync your notebooks across devices with real-time collaboration.',
    },
    {
      key: 'markdown',
      icon: 'markdown',
      label: 'Markdown',
      description:
        'Notes are saved in an extended Markdown format. Portable, readable, and future-proof.',
    },
    {
      key: 'dark',
      icon: 'dark_mode',
      label: 'Dark mode',
      description: 'Full dark theme support that follows your system preference.',
    },
    {
      key: 'chat',
      icon: 'chat',
      label: 'Conversations',
      description:
        'Real-time chat threads attached to notebooks for quick discussions and sharing.',
    },
  ];

  readonly selectedFeatureData = computed(() => {
    const key = this.selectedFeature();
    return key ? (this.features.find((f) => f.key === key) ?? null) : null;
  });

  toggleFeature(key: string): void {
    this.selectedFeature.update((current) => (current === key ? null : key));
  }

  async openFolder(): Promise<void> {
    const folder = await import('rxjs').then(({ firstValueFrom }) =>
      firstValueFrom(this.fsService.openFolderPicker()),
    );

    if (folder) {
      this.router.navigate(['/', folder.id]);
    }
  }
}
