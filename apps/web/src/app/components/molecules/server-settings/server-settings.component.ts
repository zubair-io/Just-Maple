import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NativeBridgeService } from '../../../services/native-bridge.service';
import { AuthService } from '../../../services/auth.service';

interface NetworkSettings {
  publicUrl: string;
  localUrl: string | null;
  source: string;
}

@Component({
  selector: 'app-server-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './server-settings.component.html',
})
export class ServerSettingsComponent implements OnInit {
  readonly native = inject(NativeBridgeService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  readonly isAdmin = computed(() => this.auth.user()?.admin === true);
  readonly currentHost = typeof location === 'undefined' ? '' : location.host;
  readonly network = signal<NetworkSettings | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  localAddress = '';

  async ngOnInit() {
    if (!this.isAdmin()) return;
    this.busy.set(true);
    try {
      const network = await firstValueFrom(
        this.http.get<NetworkSettings>('/api/server/settings/network'),
      );
      this.network.set(network);
      this.localAddress = network.localUrl ?? '';
    } catch {
      this.error.set('Could not load server network settings.');
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    if (!this.isAdmin() || !this.network() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      const network = await firstValueFrom(
        this.http.put<NetworkSettings>('/api/server/settings/network', {
          localUrl: this.localAddress.trim() || null,
        }),
      );
      this.network.set(network);
      this.localAddress = network.localUrl ?? '';
      this.saved.set(true);
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'Could not save server network settings.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
