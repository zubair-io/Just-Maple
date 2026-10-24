import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

describe('Development sign-in form', () => {
  const auth = {
    error: signal<string | null>(null),
    isLoading: signal(false),
    supportsPasskeys: () => false,
    loginWithDevToken: vi.fn().mockResolvedValue(undefined),
  };
  beforeEach(() => {
    auth.loginWithDevToken.mockClear();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [{ provide: AuthService, useValue: auth }],
    });
  });
  it('offers email and token sign-in on localhost even without passkey support', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('summary').textContent).toContain(
      'Development sign-in',
    );
    const email: HTMLInputElement = fixture.nativeElement.querySelector('input#devEmail');
    const token: HTMLInputElement = fixture.nativeElement.querySelector('input#devToken');
    expect(token.type).toBe('password');
    email.value = 'reader@example.com';
    email.dispatchEvent(new Event('input'));
    token.value = 'signed-token';
    token.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(auth.loginWithDevToken).toHaveBeenCalledWith('reader@example.com', 'signed-token');
    expect(fixture.componentInstance.devToken()).toBe('');
    fixture.destroy();
  });
  it('does not offer the form in production', () => {
    const previous = environment.production;
    environment.production = true;
    try {
      const fixture = TestBed.createComponent(LoginComponent);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('details')).toBeNull();
      fixture.destroy();
    } finally {
      environment.production = previous;
    }
  });
});
