import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../../organisms';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, SidebarComponent],
  template: `
    <div class="h-screen flex overflow-hidden bg-[var(--color-bg)]">
      <app-sidebar
        (newNote)="onNewNote()"
        (selectNote)="onSelectNote($event)"
        (selectTag)="onSelectTag($event)"
        (createTag)="onCreateTag()"
        (settings)="onSettings()"
      />
      <main class="flex-1 h-full overflow-y-auto flex flex-col relative">
        <ng-content />
      </main>
    </div>
  `,
})
export class MainLayoutComponent {
  onNewNote(): void {
    // TODO: Implement note creation
  }

  onSelectNote(_noteId: string): void {
    // TODO: Navigate to note
  }

  onSelectTag(_tagId: string): void {
    // TODO: Filter by tag
  }

  onCreateTag(): void {
    // TODO: Show tag creation dialog
  }

  onSettings(): void {
    // TODO: Navigate to settings
  }
}
