import { Injectable, inject } from '@angular/core';
import { NativeBridgeService } from './native-bridge.service';

@Injectable({
  providedIn: 'root',
})
export class PreferencesService {
  private readonly nativeBridge = inject(NativeBridgeService);

  // Helper to check if we're in native app
  isNativeApp(): boolean {
    return this.nativeBridge.isNativeApp();
  }
}
