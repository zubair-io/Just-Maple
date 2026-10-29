import { Component, inject } from '@angular/core';
import { NativeBridgeService } from '../../../services/native-bridge.service';

@Component({
  selector: 'app-server-settings',
  standalone: true,
  templateUrl: './server-settings.component.html',
})
export class ServerSettingsComponent {
  readonly native = inject(NativeBridgeService);
  readonly currentHost = typeof location === 'undefined' ? '' : location.host;
}
