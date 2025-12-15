import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent } from '../login.component';
import { AuthService } from '../../../services/auth.service';
import { signal, WritableSignal } from '@angular/core';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: {
    isLoading: WritableSignal<boolean>;
    error: WritableSignal<string | null>;
    supportsPasskeys: WritableSignal<boolean>;
    requestMagicLink: ReturnType<typeof vi.fn>;
    loginWithPasskey: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      isLoading: signal(false),
      error: signal(null),
      supportsPasskeys: signal(true),
      requestMagicLink: vi.fn().mockResolvedValue({ message: 'Sent', devToken: 'test-token' }),
      loginWithPasskey: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('rendering', () => {
    it('should render email input', () => {
      const emailInput = fixture.nativeElement.querySelector('input[type="email"]');
      expect(emailInput).not.toBeNull();
    });

    it('should render send magic link button', () => {
      const button = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(button.textContent).toContain('Send Magic Link');
    });

    it('should render passkey button when supported', () => {
      const buttons = fixture.nativeElement.querySelectorAll('button[type="button"]');
      const passkeyBtn = Array.from(buttons as NodeListOf<Element>).find((btn) =>
        btn.textContent?.includes('Sign in with Passkey'),
      );
      expect(passkeyBtn).not.toBeUndefined();
    });

    it('should show passkey note when not supported', async () => {
      authServiceMock.supportsPasskeys.set(false);
      fixture.detectChanges();

      const paragraphs = fixture.nativeElement.querySelectorAll('p');
      const note = Array.from(paragraphs as NodeListOf<Element>).find((p) =>
        p.textContent?.includes('HTTPS'),
      );
      expect(note).not.toBeUndefined();
    });
  });

  describe('form submission', () => {
    it('should call requestMagicLink on submit', async () => {
      component.email.set('test@example.com');

      await component.onSubmit();

      expect(authServiceMock.requestMagicLink).toHaveBeenCalledWith('test@example.com');
    });

    it('should set emailSent after successful submission', async () => {
      component.email.set('test@example.com');

      await component.onSubmit();

      expect(component.emailSent()).toBe(true);
    });

    it('should store devToken after successful submission', async () => {
      component.email.set('test@example.com');

      await component.onSubmit();

      expect(component.devToken()).toBe('test-token');
    });

    it('should not submit if email is empty', async () => {
      component.email.set('');

      await component.onSubmit();

      expect(authServiceMock.requestMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset form state', async () => {
      component.email.set('test@example.com');
      component.emailSent.set(true);
      component.devToken.set('token');

      component.reset();

      expect(component.email()).toBe('');
      expect(component.emailSent()).toBe(false);
      expect(component.devToken()).toBeNull();
    });
  });

  describe('passkey login', () => {
    it('should call loginWithPasskey without email when empty', async () => {
      component.email.set('');

      await component.loginWithPasskey();

      expect(authServiceMock.loginWithPasskey).toHaveBeenCalledWith(undefined);
    });

    it('should call loginWithPasskey with email when provided', async () => {
      component.email.set('test@example.com');

      await component.loginWithPasskey();

      expect(authServiceMock.loginWithPasskey).toHaveBeenCalledWith('test@example.com');
    });
  });

  describe('error handling', () => {
    it('should display error message', async () => {
      authServiceMock.error.set('Something went wrong');
      fixture.detectChanges();

      const paragraphs = fixture.nativeElement.querySelectorAll('p');
      const error = Array.from(paragraphs as NodeListOf<Element>).find((p) =>
        p.textContent?.includes('Something went wrong'),
      );
      expect(error).not.toBeUndefined();
    });
  });

  describe('loading state', () => {
    it('should disable button when loading', async () => {
      authServiceMock.isLoading.set(true);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button[type="submit"]');
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Sending...');
    });
  });
});
