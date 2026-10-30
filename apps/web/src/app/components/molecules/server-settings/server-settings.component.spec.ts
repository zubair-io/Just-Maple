import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ServerSettingsComponent } from './server-settings.component';
import { AuthService } from '../../../services/auth.service';
import { NativeBridgeService } from '../../../services/native-bridge.service';

describe('server-owned network settings', () => {
  const user = signal<{ admin: boolean }>({ admin: false });
  beforeEach(() => {
    user.set({ admin: false });
    TestBed.configureTestingModule({
      imports: [ServerSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user } },
        { provide: NativeBridgeService, useValue: { isNativeApp: () => false } },
      ],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('does not show server editing or request network settings for ordinary clients', () => {
    const fixture = TestBed.createComponent(ServerSettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    TestBed.inject(HttpTestingController).expectNone('/api/server/settings/network');
    fixture.destroy();
  });
  it('lets an administrator change the advertised domain on the server', async () => {
    user.set({ admin: true });
    const fixture = TestBed.createComponent(ServerSettingsComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/server/settings/network').flush({
      publicUrl: 'https://phoebe.example.com',
      localUrl: 'https://local.example.com',
      source: 'environment',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('https://local.example.com');
    input.value = 'next-local.example.com';
    input.dispatchEvent(new Event('input'));
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const save = http.expectOne('/api/server/settings/network');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ localUrl: 'next-local.example.com' });
    save.flush({
      publicUrl: 'https://phoebe.example.com',
      localUrl: 'https://next-local.example.com',
      source: 'server',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('Saved');
    fixture.destroy();
  });
});
