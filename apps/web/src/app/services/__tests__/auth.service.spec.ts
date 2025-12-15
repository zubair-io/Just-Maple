import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { PLATFORM_ID } from '@angular/core';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  describe('initial state', () => {
    it('should not be authenticated initially', () => {
      expect(service.isAuthenticated()).toBe(false);
      expect(service.user()).toBeNull();
      expect(service.accessToken()).toBeNull();
    });

    it('should not be loading initially', () => {
      expect(service.isLoading()).toBe(false);
    });

    it('should have no error initially', () => {
      expect(service.error()).toBeNull();
    });
  });

  describe('initFromStorage', () => {
    it('should restore auth from localStorage on construction', () => {
      const auth = {
        accessToken: 'test-token',
        user: { _id: '123', email: 'test@example.com' },
      };
      localStorage.setItem('auth', JSON.stringify(auth));

      // Reset TestBed to create fresh service that reads from localStorage
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [
          AuthService,
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: Router, useValue: { navigate: vi.fn() } },
        ],
      });

      const newService = TestBed.inject(AuthService);

      // Service should have restored auth
      expect(newService.accessToken()).toBe('test-token');
      expect(newService.user()?.email).toBe('test@example.com');

      // Re-setup for afterEach
      httpMock = TestBed.inject(HttpTestingController);
    });
  });

  describe('requestMagicLink', () => {
    it('should send POST request to /api/auth/magic-link', async () => {
      const promise = service.requestMagicLink('test@example.com');

      const req = httpMock.expectOne('/api/auth/magic-link');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'test@example.com' });

      req.flush({ message: 'Magic link sent', devToken: 'test-token' });

      const result = await promise;
      expect(result.message).toBe('Magic link sent');
      expect(result.devToken).toBe('test-token');
    });

    it('should set loading state during request', async () => {
      const promise = service.requestMagicLink('test@example.com');

      expect(service.isLoading()).toBe(true);

      const req = httpMock.expectOne('/api/auth/magic-link');
      req.flush({ message: 'Magic link sent' });

      await promise;
      expect(service.isLoading()).toBe(false);
    });

    it('should set error on failure', async () => {
      const promise = service.requestMagicLink('test@example.com');

      const req = httpMock.expectOne('/api/auth/magic-link');
      req.flush({ error: 'Failed to send' }, { status: 500, statusText: 'Server Error' });

      await expect(promise).rejects.toThrow('Failed to send');
      expect(service.error()).toBe('Failed to send');
    });
  });

  describe('verifyToken', () => {
    it('should verify token and store auth data', async () => {
      const promise = service.verifyToken('test-token');

      const req = httpMock.expectOne('/api/auth/verify?token=test-token');
      expect(req.request.method).toBe('GET');

      req.flush({
        accessToken: 'jwt-token',
        user: { _id: '123', email: 'test@example.com' },
      });

      await promise;

      expect(service.accessToken()).toBe('jwt-token');
      expect(service.user()?.email).toBe('test@example.com');
      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should store auth in localStorage', async () => {
      const promise = service.verifyToken('test-token');

      const req = httpMock.expectOne('/api/auth/verify?token=test-token');
      req.flush({
        accessToken: 'jwt-token',
        user: { _id: '123', email: 'test@example.com' },
      });

      await promise;

      const stored = JSON.parse(localStorage.getItem('auth')!);
      expect(stored.accessToken).toBe('jwt-token');
      expect(stored.user.email).toBe('test@example.com');
    });

    it('should throw on invalid token', async () => {
      const promise = service.verifyToken('invalid-token');

      const req = httpMock.expectOne('/api/auth/verify?token=invalid-token');
      req.flush({ error: 'Invalid token' }, { status: 401, statusText: 'Unauthorized' });

      await expect(promise).rejects.toThrow('Invalid token');
      expect(service.error()).toBe('Invalid token');
    });
  });

  describe('logout', () => {
    it('should clear auth state and navigate to login', async () => {
      // First authenticate
      service['_accessToken'].set('test-token');
      service['_user'].set({ _id: '123', email: 'test@example.com' });
      localStorage.setItem('auth', JSON.stringify({ accessToken: 'test-token', user: {} }));

      const promise = service.logout();

      const req = httpMock.expectOne('/api/auth/logout');
      req.flush({ message: 'Logged out' });

      await promise;

      expect(service.accessToken()).toBeNull();
      expect(service.user()).toBeNull();
      expect(localStorage.getItem('auth')).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('fetchCurrentUser', () => {
    it('should return null if no token', async () => {
      const result = await service.fetchCurrentUser();
      expect(result).toBeNull();
    });

    it('should fetch user if token exists', async () => {
      service['_accessToken'].set('test-token');

      const promise = service.fetchCurrentUser();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({ user: { _id: '123', email: 'test@example.com' } });

      const result = await promise;
      expect(result?.email).toBe('test@example.com');
    });

    it('should logout on fetch failure', async () => {
      service['_accessToken'].set('test-token');
      const logoutSpy = vi.spyOn(service, 'logout');

      const promise = service.fetchCurrentUser();

      const req = httpMock.expectOne('/api/auth/me');
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      await promise;
      expect(logoutSpy).toHaveBeenCalled();

      // Handle the logout POST request that gets triggered
      const logoutReq = httpMock.expectOne('/api/auth/logout');
      logoutReq.flush({ message: 'Logged out' });
    });
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });
});
