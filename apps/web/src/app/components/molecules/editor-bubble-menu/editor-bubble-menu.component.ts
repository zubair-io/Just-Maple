import { Component, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../atoms/icon/icon.component';

@Component({
  selector: 'app-editor-bubble-menu',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './editor-bubble-menu.component.html',
  styleUrl: './editor-bubble-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorBubbleMenuComponent {
  readonly openAIMenu = output<void>();

  onOpenAIMenu(): void {
    this.openAIMenu.emit();
  }
}
