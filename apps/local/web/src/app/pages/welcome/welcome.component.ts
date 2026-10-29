import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FileSystemService } from '../../services/file-system.service';
import { NativeBridgeService } from '../../services/native-bridge.service';
import { FolderService } from '../../services/folder.service';
import { isLocalFolder } from '../../providers/data-provider.interface';

interface Feature {
  key: string;
  icon: string;
  label: string;
  description: string;
}

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  private readonly fsService = inject(FileSystemService);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly folderService = inject(FolderService);
  private readonly router = inject(Router);

  readonly isFileSystemSupported = this.fsService.isSupported;
  readonly isNativeApp = computed(() => this.nativeBridge.isNativeApp());

  readonly icloudFolder = computed(() => {
    return this.folderService
      .folders()
      .find((nb) => isLocalFolder(nb._id) && this.folderService.isICloud(nb._id));
  });
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
        'Notes are stored as plain .md files on your device. No account needed, no lock-in.',
    },
    {
      key: 'todos',
      icon: 'check_box',
      label: 'Todos & priorities',
      description:
        'Inline task lists with priority levels, due dates, and color coding right inside your notes.',
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
      key: 'markdown',
      icon: 'markdown',
      label: 'Markdown',
      description: 'Notes are saved in Markdown format. Portable, readable, and future-proof.',
    },
    {
      key: 'dark',
      icon: 'dark_mode',
      label: 'Dark mode',
      description: 'Full dark theme support that follows your system preference.',
    },
    {
      key: 'tables',
      icon: 'table',
      label: 'Tables',
      description:
        'Insert and edit tables directly in your notes with full header and cell support.',
    },
    {
      key: 'slash',
      icon: 'bolt',
      label: 'Slash commands',
      description:
        'Type / to quickly insert headings, lists, code blocks, images, tables, and more.',
    },
  ];

  readonly selectedFeatureData = computed(() => {
    const key = this.selectedFeature();
    return key ? (this.features.find((f) => f.key === key) ?? null) : null;
  });

  toggleFeature(key: string): void {
    this.selectedFeature.update((current) => (current === key ? null : key));
  }

  openICloudFolder(): void {
    const nb = this.icloudFolder();
    if (nb) {
      this.router.navigate(['/', nb._id]);
    }
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
