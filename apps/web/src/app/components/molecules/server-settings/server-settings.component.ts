import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NativeBridgeService } from '../../../services/native-bridge.service';

@Component({
  selector: 'app-server-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './server-settings.component.html',
})
export class ServerSettingsComponent {
  readonly native = inject(NativeBridgeService);
  readonly address = signal('');
  readonly error = signal('');
  readonly currentHost = typeof location === 'undefined' ? '' : location.host;

  connect(): void {
    try {
      const input = this.address().trim();
      const url = new URL(input.includes('://') ? input : `https://${input}`);
      if (
        !url.hostname ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== '/' && url.pathname !== '')
      )
        throw new Error('Enter an HTTPS hostname without a path.');
      // Navigate without transferring this server's credentials or account data.
      window.location.assign(url.origin);
    } catch {
      this.error.set('Enter an HTTPS hostname, such as phoebe.justmaple.app.');
    }
  }
}
