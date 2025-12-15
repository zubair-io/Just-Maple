import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);

  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly isLoadingPasskeys = signal(false);
  readonly isAddingPasskey = signal(false);
  readonly passkeyError = signal<string | null>(null);
  readonly passkeySuccess = signal<string | null>(null);

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
}
