import { TestBed } from '@angular/core/testing';
import { effect, signal } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { authInterceptor } from '../auth.interceptor';
import { AuthService } from '../../services/auth.service';

describe('authInterceptor', () => {
  it('adds the token without making a calling effect depend on it', () => {
    const token = signal<string | null>('token-1');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { accessToken: token, initReady$: of(true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    let runs = 0;
    TestBed.runInInjectionContext(() =>
      effect(() => {
        runs++;
        http.get('/api/things').subscribe();
      }),
    );
    TestBed.tick();
    const first = backend.expectOne((req) => req.url.endsWith('/api/things'));
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-1');

    // A refreshed token must not re-run the effect and send the request again.
    token.set('token-2');
    TestBed.tick();
    expect(runs).toBe(1);
    backend.verify({ ignoreCancelled: true });
  });
});

describe('native LAN fallback', () => {
  const primary = 'https://phoebe.justmaple.app';
  const local = 'https://local.phoebe.justmaple.app';
  const browser = window as Window & {
    __mapleServerIdentity?: {
      serverUrl: string;
      publicApiUrl: string;
      apiUrl: string;
      localUrl: string;
    };
  };
  beforeEach(() => {
    browser.__mapleServerIdentity = {
      serverUrl: primary,
      publicApiUrl: primary,
      apiUrl: local,
      localUrl: local,
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { accessToken: () => 'account-token', initReady$: of(true) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });
  afterEach(() => {
    delete browser.__mapleServerIdentity;
  });
  it('retries a failed LAN read over the public endpoint with the same account token', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    let result: unknown;
    http.get('/api/notebooks').subscribe((value) => (result = value));
    backend.expectOne(`${local}/api/notebooks`).error(new ProgressEvent('error'));
    const retry = backend.expectOne(`${primary}/api/notebooks`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer account-token');
    retry.flush({ notebooks: [] });
    expect(result).toEqual({ notebooks: [] });
    backend.verify();
  });
  it('does not replay an uncertain write and uses the public endpoint for the next request', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const error = vi.fn();
    http.post('/api/messages', { body: 'once' }).subscribe({ error });
    backend.expectOne(`${local}/api/messages`).error(new ProgressEvent('error'));
    backend.expectNone(`${primary}/api/messages`);
    expect(error).toHaveBeenCalledTimes(1);
    http.get('/api/notebooks').subscribe();
    backend.expectOne(`${primary}/api/notebooks`).flush({ notebooks: [] });
    backend.verify();
  });
});
