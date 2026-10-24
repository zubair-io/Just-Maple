import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { IndexedDBService } from './indexed-db.service';
import { NativeBridgeService } from './native-bridge.service';

describe('development session import', () => {
  const navigate = vi.fn().mockResolvedValue(true);
  beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate, url: '/login' } },
        { provide: IndexedDBService, useValue: {} },
        { provide: NativeBridgeService, useValue: { isNativeApp: () => false } },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    localStorage.clear();
  });
  it('sends the token while logged out, stores the verified session, and navigates home', async () => {
    const service = TestBed.inject(AuthService);
    const pending = service.loginWithDevToken(' reader@example.com ', ' signed-token ');
    const req = TestBed.inject(HttpTestingController).expectOne('/api/auth/dev-token');
    expect(req.request.body).toEqual({ email: 'reader@example.com', token: 'signed-token' });
    req.flush({
      accessToken: 'verified-token',
      user: { _id: 'reader', email: 'reader@example.com' },
    });
    await pending;
    expect(service.accessToken()).toBe('verified-token');
    expect(JSON.parse(localStorage.getItem(`auth:${location.origin}`)!).accessToken).toBe(
      'verified-token',
    );
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(service.isLoading()).toBe(false);
  });
  it('leaves the user signed out and displays invalid-token errors', async () => {
    const service = TestBed.inject(AuthService);
    const pending = service.loginWithDevToken('reader@example.com', 'invalid');
    const rejected = expect(pending).rejects.toThrow('Invalid token');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/dev-token')
      .flush({ error: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' });
    await rejected;
    expect(service.accessToken()).toBeNull();
    expect(service.error()).toBe('Invalid token');
    expect(service.isLoading()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
