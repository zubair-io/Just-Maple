import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileAvatarComponent } from '../../atoms';
import type { NotebookMember } from '@maple/shared';

@Component({
  selector: 'app-member-avatar-group',
  standalone: true,
  imports: [CommonModule, ProfileAvatarComponent],
  templateUrl: './member-avatar-group.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './member-avatar-group.component.scss',
})
export class MemberAvatarGroupComponent {
  readonly members = input.required<NotebookMember[]>();
  readonly maxDisplay = input<number>(5);
  readonly size = input<'xs' | 'sm' | 'md' | 'lg' | 'xl'>('sm');
  readonly clickable = input<boolean>(true);

  // Event when group is clicked
  readonly clicked = output<void>();

  // Display members (limited to maxDisplay)
  readonly displayMembers = computed(() => {
    const max = this.maxDisplay();
    return this.members().slice(0, max);
  });

  // Count of remaining members not displayed
  readonly remainingCount = computed(() => {
    const total = this.members().length;
    const max = this.maxDisplay();
    return Math.max(0, total - max);
  });

  onGroupClick(): void {
    if (this.clickable()) {
      this.clicked.emit();
    }
  }
}
