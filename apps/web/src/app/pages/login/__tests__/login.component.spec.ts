import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../../../services/auth.service';
import { LoginComponent } from '../login.component';
import { environment } from '../../../../environments/environment';

describe('Passkey login', () => {
  const originalProduction = environment.production;
  afterEach(() => {
    environment.production = originalProduction;
  });
  const auth = {
    isLoading: signal(false),
    error: signal<string | null>(null),
    supportsPasskeys: signal(true),
    signupWithPasskey: vi.fn().mockResolvedValue(undefined),
    loginWithPasskey: vi.fn().mockResolvedValue(undefined),
  };
  beforeAll(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  beforeEach(() => {
    environment.production = true;
    vi.clearAllMocks();
    auth.isLoading.set(false);
    auth.error.set(null);
    auth.supportsPasskeys.set(true);
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideZonelessChangeDetection(), { provide: AuthService, useValue: auth }],
    });
  });
  it('shows passkey sign-in without email, code or server fields', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sign in with a passkey');
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });
  it('requires a display name to create an account', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.creatingAccount.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Display name');
    component.displayName.set('   ');
    await component.onSubmit();
    expect(auth.signupWithPasskey).not.toHaveBeenCalled();
    component.displayName.set('Reader');
    await component.onSubmit();
    expect(auth.signupWithPasskey).toHaveBeenCalledWith('Reader');
  });
  it('explains unsupported browsers instead of offering a dead login action', () => {
    auth.supportsPasskeys.set(false);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('browser that supports passkeys');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });
});
