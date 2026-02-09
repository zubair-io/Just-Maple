import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NativeBridgeService } from '../../services/native-bridge.service';

@Component({
  selector: 'app-gmail-oauth-callback',
  standalone: true,
  templateUrl: './gmail-oauth-callback.component.html',
})
export class GmailOAuthCallbackComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly nativeBridge = inject(NativeBridgeService);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.router.navigate(['/']);
      return;
    }

    const params = this.route.snapshot.queryParams;
    const code = params['code'] as string | undefined;
    const state = params['state'] as string | undefined;
    const error = params['error'] as string | undefined;

    if (window.opener) {
      // Browser popup flow: send result back to opener via postMessage
      window.opener.postMessage(
        { type: 'gmail_oauth_callback', code, state, error },
        window.location.origin,
      );
      window.close();
    } else if (this.nativeBridge.isNativeApp()) {
      // Native app flow: relay result via native bridge
      this.nativeBridge.sendGmailOAuthResult({ code, state, error });
      window.close();
    } else {
      // Direct navigation fallback — redirect to app root
      this.router.navigate(['/']);
    }
  }
}
