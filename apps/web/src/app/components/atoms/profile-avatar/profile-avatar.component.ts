import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-profile-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-avatar.component.html',
  styleUrl: './profile-avatar.component.scss',
})
export class ProfileAvatarComponent {
  // Required inputs
  readonly displayName = input<string | undefined>();
  readonly email = input.required<string>();
  readonly profilePictureUrl = input<string | undefined>();

  // Optional styling inputs
  readonly size = input<AvatarSize>('md');
  readonly showBorder = input<boolean>(true);

  // Compute initials from display name or email
  readonly initials = computed(() => {
    const name = this.displayName() || this.email().split('@')[0];
    return name.slice(0, 2).toUpperCase();
  });

  // Size classes mapping
  readonly sizeClasses = computed(() => {
    const sizes: Record<AvatarSize, string> = {
      xs: 'w-5 h-5 text-[10px]',
      sm: 'w-7 h-7 text-xs',
      md: 'w-10 h-10 text-sm',
      lg: 'w-12 h-12 text-base',
      xl: 'w-16 h-16 text-xl',
    };
    return sizes[this.size()];
  });
}
