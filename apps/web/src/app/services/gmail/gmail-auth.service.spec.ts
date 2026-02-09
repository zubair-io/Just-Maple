import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { GmailAuthService } from './gmail-auth.service';
import { GmailCryptoService } from './gmail-crypto.service';
import { IndexedDBService } from '../indexed-db.service';
import { AuthService } from '../auth.service';
import { signal } from '@angular/core';

describe('GmailAuthService', () => {
  let service: GmailAuthService;
  let cryptoServiceSpy: jasmine.SpyObj<GmailCryptoService>;
  let indexedDBServiceSpy: jasmine.SpyObj<IndexedDBService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const mockUser = { _id: 'user-123', email: 'user@example.com' };

  beforeEach(() => {
    cryptoServiceSpy = jasmine.createSpyObj('GmailCryptoService', [
      'initializeKey',
      'encrypt',
      'decrypt',
      'clearKey',
      'clearUserData',
      'isInitialized',
    ]);

    indexedDBServiceSpy = jasmine.createSpyObj('IndexedDBService', ['getAll', 'put', 'clear']);

    authServiceSpy = jasmine.createSpyObj('AuthService', [], {
      user: signal(mockUser),
    });

    // Default return values
    cryptoServiceSpy.isInitialized.and.returnValue(false);
    cryptoServiceSpy.initializeKey.and.returnValue(Promise.resolve());
    cryptoServiceSpy.encrypt.and.callFake((value: string) => Promise.resolve(`encrypted:${value}`));
    cryptoServiceSpy.decrypt.and.callFake((value: string) =>
      Promise.resolve(value.replace('encrypted:', '')),
    );
    indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve([]));
    indexedDBServiceSpy.put.and.returnValue(Promise.resolve(undefined));
    indexedDBServiceSpy.clear.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        GmailAuthService,
        { provide: GmailCryptoService, useValue: cryptoServiceSpy },
        { provide: IndexedDBService, useValue: indexedDBServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(GmailAuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start as not connected', () => {
      expect(service.isConnected()).toBe(false);
    });

    it('should have no connected email initially', () => {
      expect(service.connectedEmail()).toBeNull();
    });

    it('should not be authenticating initially', () => {
      expect(service.isAuthenticating()).toBe(false);
    });
  });

  describe('initializeFromStorage', () => {
    it('should initialize crypto key with user id', fakeAsync(() => {
      tick();
      expect(cryptoServiceSpy.initializeKey).toHaveBeenCalledWith('user-123');
    }));

    it('should restore connection from stored tokens', fakeAsync(() => {
      const storedTokens = [
        {
          accountEmail: 'stored@gmail.com',
          accessToken: 'encrypted:access-token',
          refreshToken: 'encrypted:refresh-token',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      ];
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve(storedTokens));

      // Reset TestBed and recreate service to trigger initialization
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          GmailAuthService,
          { provide: GmailCryptoService, useValue: cryptoServiceSpy },
          { provide: IndexedDBService, useValue: indexedDBServiceSpy },
          { provide: AuthService, useValue: authServiceSpy },
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      service = TestBed.inject(GmailAuthService);
      tick();

      expect(service.isConnected()).toBe(true);
      expect(service.connectedEmail()).toBe('stored@gmail.com');
    }));
  });

  describe('authenticate', () => {
    it('should set isAuthenticating to true during auth flow', () => {
      // Mock window.open to prevent actual popup
      spyOn(window, 'open').and.returnValue(null);

      const subscription = service.authenticate().subscribe({
        error: () => {
          // Expected to error since popup is null
        },
      });

      expect(service.isAuthenticating()).toBe(true);
      subscription.unsubscribe();
    });

    it('should error if popup is blocked', (done) => {
      spyOn(window, 'open').and.returnValue(null);

      service.authenticate().subscribe({
        error: (error) => {
          expect(error.message).toContain('popup');
          expect(service.isAuthenticating()).toBe(false);
          done();
        },
      });
    });
  });

  describe('getAccessToken', () => {
    it('should throw if no tokens are available', async () => {
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve([]));

      await expectAsync(service.getAccessToken()).toBeRejectedWithError(/No Gmail tokens/);
    });

    it('should return cached token if not expired', async () => {
      const storedTokens = [
        {
          accountEmail: 'test@gmail.com',
          accessToken: 'encrypted:valid-token',
          refreshToken: 'encrypted:refresh-token',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
        },
      ];
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve(storedTokens));

      const token = await service.getAccessToken();
      expect(token).toBe('valid-token');
    });
  });

  describe('disconnect', () => {
    it('should clear all Gmail stores', async () => {
      await service.disconnect();

      expect(indexedDBServiceSpy.clear).toHaveBeenCalledWith('gmail-tokens');
      expect(indexedDBServiceSpy.clear).toHaveBeenCalledWith('gmail-emails');
      expect(indexedDBServiceSpy.clear).toHaveBeenCalledWith('gmail-sync-state');
      expect(indexedDBServiceSpy.clear).toHaveBeenCalledWith('gmail-drafts');
    });

    it('should clear crypto data for user', async () => {
      await service.disconnect();

      expect(cryptoServiceSpy.clearUserData).toHaveBeenCalledWith('user-123');
    });

    it('should reset connection state', async () => {
      // First simulate being connected
      const storedTokens = [
        {
          accountEmail: 'connected@gmail.com',
          accessToken: 'encrypted:token',
          refreshToken: 'encrypted:refresh',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      ];
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve(storedTokens));
      await service.checkConnection();

      expect(service.isConnected()).toBe(true);

      // Now disconnect
      await service.disconnect();

      expect(service.isConnected()).toBe(false);
      expect(service.connectedEmail()).toBeNull();
    });
  });

  describe('checkConnection', () => {
    it('should return true if tokens exist', async () => {
      const storedTokens = [
        {
          accountEmail: 'test@gmail.com',
          accessToken: 'encrypted:token',
          refreshToken: 'encrypted:refresh',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      ];
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve(storedTokens));

      const connected = await service.checkConnection();

      expect(connected).toBe(true);
      expect(service.isConnected()).toBe(true);
      expect(service.connectedEmail()).toBe('test@gmail.com');
    });

    it('should return false if no tokens', async () => {
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve([]));

      const connected = await service.checkConnection();

      expect(connected).toBe(false);
      expect(service.isConnected()).toBe(false);
    });

    it('should return false if decryption fails', async () => {
      const storedTokens = [
        {
          accountEmail: 'test@gmail.com',
          accessToken: 'corrupted-data',
          refreshToken: 'corrupted-data',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      ];
      indexedDBServiceSpy.getAll.and.returnValue(Promise.resolve(storedTokens));
      cryptoServiceSpy.decrypt.and.returnValue(Promise.reject(new Error('Decryption failed')));

      const connected = await service.checkConnection();

      expect(connected).toBe(false);
      expect(indexedDBServiceSpy.clear).toHaveBeenCalledWith('gmail-tokens');
    });
  });

  describe('PKCE helpers', () => {
    it('should store code verifier in session storage', () => {
      spyOn(window, 'open').and.returnValue(null);
      spyOn(sessionStorage, 'setItem');

      service.authenticate().subscribe({
        error: () => {},
      });

      expect(sessionStorage.setItem).toHaveBeenCalledWith(
        'gmail_code_verifier',
        jasmine.any(String),
      );
      expect(sessionStorage.setItem).toHaveBeenCalledWith('gmail_oauth_state', jasmine.any(String));
    });
  });
});
