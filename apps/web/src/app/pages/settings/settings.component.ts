import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PreferencesService } from '../../services/preferences.service';
import { NotificationService } from '../../services/notification.service';
import { ThemeService, ThemeId } from '../../services/theme.service';
import { TagService, TagWithMeta } from '../../services/tag.service';
import { ProfileAvatarComponent, SettingsHeaderComponent } from '../../components';

interface PasskeyInfo {
  id: string;
  visibleId: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent, SettingsHeaderComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly preferences = inject(PreferencesService);
  readonly notifications = inject(NotificationService);
  readonly themeService = inject(ThemeService);
  readonly tagService = inject(TagService);

  // Check if current user is an admin
  readonly isAdmin = computed(() => this.authService.user()?.admin === true);

  // Tag colors state
  readonly isLoadingTags = signal(false);
  readonly editingTagColor = signal<string | null>(null);

  // Preset colors for tag color picker
  readonly tagColorPresets = [
    '#dc2626', // red
    '#ea580c', // orange
    '#ca8a04', // yellow
    '#16a34a', // green
    '#0891b2', // cyan
    '#2563eb', // blue
    '#7c3aed', // violet
    '#c026d3', // fuchsia
    '#475569', // slate
  ];

  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly isLoadingPasskeys = signal(false);
  readonly isAddingPasskey = signal(false);
  readonly passkeyError = signal<string | null>(null);
  readonly passkeySuccess = signal<string | null>(null);

  readonly showAddServerDialog = signal(false);
  readonly newServerName = signal('');
  readonly newServerUrl = signal('');
  readonly newServerApiUrl = signal('');
  readonly showAdvanced = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly displayName = signal('');
  readonly isSavingName = signal(false);
  readonly nameError = signal<string | null>(null);
  readonly nameSuccess = signal<string | null>(null);

  readonly profilePictureUrl = signal<string | null>(null);
  readonly isUploadingPicture = signal(false);
  readonly pictureError = signal<string | null>(null);
  readonly pictureSuccess = signal<string | null>(null);

  ngOnInit(): void {
    this.loadPasskeys();
    this.loadTags();
    // Initialize display name and profile picture from current user
    const user = this.authService.user();
    console.log('Loaded user in settings:', user);
    if (user) {
      this.displayName.set(user.displayName || '');
      this.profilePictureUrl.set(user.profilePictureUrl || null);
    }
  }

  loadTags(): void {
    this.isLoadingTags.set(true);
    this.tagService.loadTags().subscribe({
      next: () => {
        this.isLoadingTags.set(false);
      },
      error: () => {
        this.isLoadingTags.set(false);
      },
    });
  }

  loadPasskeys(): void {
    this.isLoadingPasskeys.set(true);
    this.authService.getPasskeys().subscribe({
      next: (passkeys) => {
        this.passkeys.set(passkeys);
        this.isLoadingPasskeys.set(false);
      },
      error: () => {
        // Silently fail - passkeys will just show empty
        this.isLoadingPasskeys.set(false);
      },
    });
  }

  addPasskey(): void {
    if (!this.authService.supportsPasskeys()) {
      this.passkeyError.set('Passkeys are not supported on this device or browser');
      return;
    }

    this.isAddingPasskey.set(true);
    this.passkeyError.set(null);
    this.passkeySuccess.set(null);

    this.authService.registerPasskey().subscribe({
      next: (passkey) => {
        this.passkeys.update((list) => [...list, passkey]);
        this.passkeySuccess.set('Passkey added successfully!');

        // Clear success message after 3 seconds
        setTimeout(() => this.passkeySuccess.set(null), 3000);
        this.isAddingPasskey.set(false);
      },
      error: (err: any) => {
        this.passkeyError.set(err.message || 'Failed to add passkey');
        this.isAddingPasskey.set(false);
      },
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  getDeviceTypeLabel(deviceType: string): string {
    switch (deviceType) {
      case 'singleDevice':
        return 'This device only';
      case 'multiDevice':
        return 'Synced across devices';
      default:
        return deviceType;
    }
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  goToBots(): void {
    this.router.navigate(['/settings/bots']);
  }

  setTheme(themeId: ThemeId): void {
    this.themeService.setTheme(themeId);
  }

  async logout(): Promise<void> {
    // Unregister from push notifications before logging out
    if (this.preferences.isNativeApp() && this.notifications.isRegistered()) {
      try {
        await this.notifications.unregisterPushNotifications();
      } catch (error) {
        console.error('[Settings] Failed to unregister push notifications on logout:', error);
      }
    }
    await this.authService.logout();
  }

  // Server Management
  switchServer(serverId: string): void {
    this.preferences.setActiveServer(serverId).subscribe();
  }

  openAddServerDialog(): void {
    this.showAddServerDialog.set(true);
    this.newServerName.set('');
    this.newServerUrl.set('');
    this.newServerApiUrl.set('');
    this.showAdvanced.set(false);
    this.serverError.set(null);
  }

  closeAddServerDialog(): void {
    this.showAddServerDialog.set(false);
  }

  addServer(): void {
    const name = this.newServerName().trim();
    const url = this.newServerUrl().trim();
    const apiUrl = this.newServerApiUrl().trim();

    if (!name || !url) {
      this.serverError.set('Please enter both name and URL');
      return;
    }

    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.serverError.set('URL must start with http:// or https://');
      return;
    }

    // Validate API URL if provided
    if (apiUrl && !apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
      this.serverError.set('API URL must start with http:// or https://');
      return;
    }

    this.serverError.set(null);

    this.preferences.addServer(name, url, apiUrl || undefined).subscribe({
      next: () => {
        this.closeAddServerDialog();
      },
      error: (err: any) => {
        this.serverError.set(err.message || 'Failed to add server');
      },
    });
  }

  removeServer(serverId: string): void {
    if (confirm('Are you sure you want to remove this server?')) {
      this.preferences.removeServer(serverId).subscribe();
    }
  }

  // Notification Management
  async requestPushPermission(): Promise<void> {
    try {
      const granted = await this.notifications.requestPushPermission();
      if (granted) {
        console.log('[Settings] Push permission granted');
      } else {
        console.log('[Settings] Push permission denied');
      }
    } catch (error) {
      console.error('[Settings] Failed to request push permission:', error);
    }
  }

  async disablePushNotifications(): Promise<void> {
    if (!confirm('Are you sure you want to disable push notifications?')) {
      return;
    }

    try {
      await this.notifications.unregisterPushNotifications();
      console.log('[Settings] Push notifications disabled');
    } catch (error) {
      console.error('[Settings] Failed to disable push notifications:', error);
    }
  }

  // Profile Management
  saveDisplayName(): void {
    this.isSavingName.set(true);
    this.nameError.set(null);
    this.nameSuccess.set(null);

    this.authService.updateDisplayName(this.displayName().trim() || undefined).subscribe({
      next: () => {
        this.nameSuccess.set('Display name updated!');

        // Clear success message after 3 seconds
        setTimeout(() => this.nameSuccess.set(null), 3000);
        this.isSavingName.set(false);
      },
      error: (err: any) => {
        this.nameError.set(err.message || 'Failed to update display name');
        this.isSavingName.set(false);
      },
    });
  }

  onProfilePictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.pictureError.set('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      this.pictureError.set('Image must be less than 5MB');
      return;
    }

    this.isUploadingPicture.set(true);
    this.pictureError.set(null);
    this.pictureSuccess.set(null);

    this.authService.uploadProfilePicture(file).subscribe({
      next: () => {
        this.pictureSuccess.set('Profile picture updated!');
        // Update local preview
        const user = this.authService.user();
        if (user?.profilePictureUrl) {
          this.profilePictureUrl.set(user.profilePictureUrl);
        }

        // Clear success message after 3 seconds
        setTimeout(() => this.pictureSuccess.set(null), 3000);
        this.isUploadingPicture.set(false);
        // Clear the input so the same file can be selected again
        input.value = '';
      },
      error: (err: any) => {
        this.pictureError.set(err.message || 'Failed to upload profile picture');
        this.isUploadingPicture.set(false);
        // Clear the input so the same file can be selected again
        input.value = '';
      },
    });
  }

  // Tag color management
  toggleEditTagColor(tagName: string): void {
    if (this.editingTagColor() === tagName) {
      this.editingTagColor.set(null);
    } else {
      this.editingTagColor.set(tagName);
    }
  }

  setTagColor(tagName: string, color: string): void {
    this.tagService.setTagColor(tagName, color).subscribe(() => {
      this.editingTagColor.set(null);
    });
  }

  removeTagColor(tagName: string): void {
    this.tagService.removeTagColor(tagName).subscribe(() => {
      this.editingTagColor.set(null);
    });
  }
}
