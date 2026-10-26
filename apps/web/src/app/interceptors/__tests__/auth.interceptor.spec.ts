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
