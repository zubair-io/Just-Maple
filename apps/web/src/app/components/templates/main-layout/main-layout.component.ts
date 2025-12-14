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
    console.log('Create new note');
    // TODO: Implement note creation
  }

  onSelectNote(noteId: string): void {
    console.log('Selected note:', noteId);
    // TODO: Navigate to note
  }

  onSelectTag(tagId: string): void {
    console.log('Selected tag:', tagId);
    // TODO: Filter by tag
  }

  onCreateTag(): void {
    console.log('Create new tag');
    // TODO: Show tag creation dialog
  }

  onSettings(): void {
    console.log('Open settings');
    // TODO: Navigate to settings
  }
}
