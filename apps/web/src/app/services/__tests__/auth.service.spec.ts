import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { AuthService } from '../auth.service';
import { IndexedDBService } from '../indexed-db.service';
import { NativeBridgeService } from '../native-bridge.service';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: () => true,
}));

describe('Passkey AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  const router = {
    navigate: vi.fn().mockResolvedValue(true),
    navigateByUrl: vi.fn().mockResolvedValue(true),
  };
  beforeAll(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        AuthService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Router, useValue: router },
        { provide: IndexedDBService, useValue: { clearAll: vi.fn().mockResolvedValue(undefined) } },
        { provide: NativeBridgeService, useValue: { isNativeApp: () => false } },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('creates an account without sending or storing email', async () => {
    vi.mocked(startRegistration).mockResolvedValue({ id: 'key' } as any);
    const promise = service.signupWithPasskey('  Maple reader  ');
    const start = http.expectOne('/api/auth/passkey/signup/start');
    expect(start.request.body).toEqual({ displayName: 'Maple reader' });
    start.flush({ challenge: 'challenge' });
    await vi.waitFor(() => expect(startRegistration).toHaveBeenCalled());
    const finish = http.expectOne('/api/auth/passkey/signup/finish');
    expect(finish.request.body).toEqual({ id: 'key' });
    finish.flush({ accessToken: 'token', user: { _id: 'reader-id', displayName: 'Maple reader' } });
    await promise;
    expect(service.user()?.displayName).toBe('Maple reader');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isLoading()).toBe(false);
    expect(JSON.parse(localStorage.getItem(`auth:${location.origin}`)!).user.email).toBeUndefined();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('signs in without an email filter', async () => {
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'key' } as any);
    const promise = service.loginWithPasskey();
    const start = http.expectOne('/api/auth/passkey/login/start');
    expect(start.request.body).toEqual({});
    start.flush({ challenge: 'challenge' });
    await vi.waitFor(() => expect(startAuthentication).toHaveBeenCalled());
    http
      .expectOne('/api/auth/passkey/login/finish')
      .flush({ accessToken: 'token', user: { _id: 'reader-id', displayName: 'Reader' } });
    await promise;
    expect(service.accessToken()).toBe('token');
    expect(service.isLoading()).toBe(false);
  });

  it('does not create a session when the authenticator is cancelled', async () => {
    vi.mocked(startRegistration).mockRejectedValue(new Error('Passkey creation cancelled'));
    const promise = service.signupWithPasskey('Reader');
    const rejected = expect(promise).rejects.toThrow('Passkey creation cancelled');
    http.expectOne('/api/auth/passkey/signup/start').flush({ challenge: 'challenge' });
    await rejected;
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBe('Passkey creation cancelled');
    http.expectNone('/api/auth/passkey/signup/finish');
  });
});
