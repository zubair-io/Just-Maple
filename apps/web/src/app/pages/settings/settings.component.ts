import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PreferencesService } from '../../services/preferences.service';
import { NotificationService } from '../../services/notification.service';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly preferences = inject(PreferencesService);
  readonly notifications = inject(NotificationService);

  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly isLoadingPasskeys = signal(false);
  readonly isAddingPasskey = signal(false);
  readonly passkeyError = signal<string | null>(null);
  readonly passkeySuccess = signal<string | null>(null);

  readonly showAddServerDialog = signal(false);
  readonly newServerName = signal('');
  readonly newServerUrl = signal('');
  readonly serverError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadPasskeys();
  }

  async loadPasskeys(): Promise<void> {
    this.isLoadingPasskeys.set(true);
    try {
      const passkeys = await this.authService.getPasskeys();
      this.passkeys.set(passkeys);
    } catch {
      // Silently fail - passkeys will just show empty
    } finally {
      this.isLoadingPasskeys.set(false);
    }
  }

  async addPasskey(): Promise<void> {
    if (!this.authService.supportsPasskeys()) {
      this.passkeyError.set('Passkeys are not supported on this device or browser');
      return;
    }

    this.isAddingPasskey.set(true);
    this.passkeyError.set(null);
    this.passkeySuccess.set(null);

    try {
      const passkey = await this.authService.registerPasskey();
      this.passkeys.update((list) => [...list, passkey]);
      this.passkeySuccess.set('Passkey added successfully!');

      // Clear success message after 3 seconds
      setTimeout(() => this.passkeySuccess.set(null), 3000);
    } catch (err: any) {
      this.passkeyError.set(err.message || 'Failed to add passkey');
    } finally {
      this.isAddingPasskey.set(false);
    }
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

  async logout(): Promise<void> {
    await this.authService.logout();
  }

  // Server Management
  async switchServer(serverId: string): Promise<void> {
    await this.preferences.setActiveServer(serverId);
  }

  openAddServerDialog(): void {
    this.showAddServerDialog.set(true);
    this.newServerName.set('');
    this.newServerUrl.set('');
    this.serverError.set(null);
  }

  closeAddServerDialog(): void {
    this.showAddServerDialog.set(false);
  }

  async addServer(): Promise<void> {
    const name = this.newServerName().trim();
    const url = this.newServerUrl().trim();

    if (!name || !url) {
      this.serverError.set('Please enter both name and URL');
      return;
    }

    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.serverError.set('URL must start with http:// or https://');
      return;
    }

    this.serverError.set(null);

    try {
      await this.preferences.addServer(name, url);
      this.closeAddServerDialog();
    } catch (err: any) {
      this.serverError.set(err.message || 'Failed to add server');
    }
  }

  async removeServer(serverId: string): Promise<void> {
    if (confirm('Are you sure you want to remove this server?')) {
      await this.preferences.removeServer(serverId);
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
}
