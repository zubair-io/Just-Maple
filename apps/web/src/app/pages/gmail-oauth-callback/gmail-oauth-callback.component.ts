import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NativeBridgeService } from '../../services/native-bridge.service';
import { GmailAuthService } from '../../services/gmail/gmail-auth.service';
import { GoogleCalendarService } from '../../services/google-calendar/google-calendar.service';

@Component({
  selector: 'app-gmail-oauth-callback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './gmail-oauth-callback.component.html',
})
export class GmailOAuthCallbackComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly gmailAuth = inject(GmailAuthService);
  private readonly googleCalendar = inject(GoogleCalendarService);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.router.navigate(['/']);
      return;
    }

    const params = this.route.snapshot.queryParams;
    const code = params['code'] as string | undefined;
    const state = params['state'] as string | undefined;
    const error = params['error'] as string | undefined;
    const svc = params['svc'] as string | undefined;

    console.log(
      '[OAuthCallback] params: code=%s, state=%s, error=%s, svc=%s',
      code ? 'present' : 'null',
      state ? 'present' : 'null',
      error,
      svc,
    );

    // Native app flow: relay result via native bridge
    if (this.nativeBridge.isNativeApp()) {
      this.nativeBridge.sendGmailOAuthResult({ code, state, error });
      window.close();
      return;
    }

    // Web redirect flow
    if (error) {
      this.navigateToReturnUrl();
      return;
    }

    if (!code || !state) {
      this.navigateToReturnUrl();
      return;
    }

    // Google returns the encoded state (base64 JSON with {s, p, svc, o}).
    // Decode it to extract the raw state and svc for validation.
    const { rawState, decodedSvc } = this.decodeOAuthState(state);
    const service = svc || decodedSvc || 'gmail';
    console.log(
      '[OAuthCallback] decoded service=%s, rawState=%s',
      service,
      rawState ? 'present' : 'null',
    );

    // Validate raw state against sessionStorage
    const stateKey = service === 'gcal' ? 'gcal_oauth_state' : 'gmail_oauth_state';
    const expectedState = sessionStorage.getItem(stateKey);

    if (rawState !== expectedState) {
      console.error('[OAuthCallback] state mismatch: expected=%s, got=%s', expectedState, rawState);
      this.navigateToReturnUrl();
      return;
    }

    console.log('[OAuthCallback] state validated, completing %s token exchange', service);

    // Complete token exchange via the appropriate service
    const completion$ =
      service === 'gcal'
        ? this.googleCalendar.completeOAuthFromCallback(code)
        : this.gmailAuth.completeOAuthFromCallback(code);

    completion$.subscribe({
      next: () => this.navigateToReturnUrl(),
      error: (err) => {
        console.error('OAuth token exchange failed:', err);
        this.navigateToReturnUrl();
      },
    });
  }

  private decodeOAuthState(encoded: string): { rawState: string; decodedSvc?: string } {
    try {
      const json = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
      return { rawState: json.s || encoded, decodedSvc: json.svc };
    } catch {
      // Not encoded — treat the whole string as the raw state
      return { rawState: encoded };
    }
  }

  private navigateToReturnUrl(): void {
    const returnUrl = sessionStorage.getItem('oauth_return_url');
    sessionStorage.removeItem('oauth_return_url');

    if (returnUrl) {
      // Parse the return URL to extract the path for Angular router
      try {
        const url = new URL(returnUrl);
        this.router.navigateByUrl(url.pathname + url.search + url.hash);
      } catch {
        this.router.navigate(['/']);
      }
    } else {
      this.router.navigate(['/']);
    }
  }
}
