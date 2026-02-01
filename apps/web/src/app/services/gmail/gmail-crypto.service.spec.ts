import { TestBed } from '@angular/core/testing';
import { GmailCryptoService } from './gmail-crypto.service';

describe('GmailCryptoService', () => {
  let service: GmailCryptoService;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [GmailCryptoService],
    });

    service = TestBed.inject(GmailCryptoService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initializeKey', () => {
    it('should initialize crypto key for user', async () => {
      await service.initializeKey('user-123');

      expect(service.isInitialized()).toBe(true);
    });

    it('should store salt in localStorage', async () => {
      await service.initializeKey('user-123');

      const saltKey = 'gmail-crypto-salt-user-123';
      expect(localStorage.getItem(saltKey)).toBeTruthy();
    });

    it('should reuse existing salt for same user', async () => {
      await service.initializeKey('user-123');
      const saltKey = 'gmail-crypto-salt-user-123';
      const firstSalt = localStorage.getItem(saltKey);

      // Clear the key and reinitialize
      service.clearKey();
      await service.initializeKey('user-123');

      expect(localStorage.getItem(saltKey)).toBe(firstSalt);
    });

    it('should create different salts for different users', async () => {
      await service.initializeKey('user-123');
      const salt1 = localStorage.getItem('gmail-crypto-salt-user-123');

      service.clearKey();
      await service.initializeKey('user-456');
      const salt2 = localStorage.getItem('gmail-crypto-salt-user-456');

      expect(salt1).not.toBe(salt2);
    });
  });

  describe('encrypt and decrypt', () => {
    beforeEach(async () => {
      await service.initializeKey('test-user');
    });

    it('should encrypt and decrypt a string', async () => {
      const plaintext = 'my-secret-token-123';

      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const plaintext = 'my-secret-token';

      const encrypted1 = await service.encrypt(plaintext);
      const encrypted2 = await service.encrypt(plaintext);

      // Different IVs should produce different ciphertexts
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same plaintext
      expect(await service.decrypt(encrypted1)).toBe(plaintext);
      expect(await service.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle special characters', async () => {
      const plaintext = 'token with special chars: !@#$%^&*()_+{}[]|\\:";\'<>?,./`~';

      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle Unicode characters', async () => {
      const plaintext = 'Token with Unicode: 你好世界 🎉 émoji';

      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', async () => {
      const plaintext = '';

      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const plaintext = 'a'.repeat(10000);

      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('error handling', () => {
    it('should throw if encrypting without initialization', async () => {
      await expectAsync(service.encrypt('test')).toBeRejectedWithError(
        /Crypto key not initialized/,
      );
    });

    it('should throw if decrypting without initialization', async () => {
      await expectAsync(service.decrypt('test')).toBeRejectedWithError(
        /Crypto key not initialized/,
      );
    });

    it('should throw if decrypting invalid data', async () => {
      await service.initializeKey('test-user');

      await expectAsync(service.decrypt('invalid-data')).toBeRejected();
    });

    it('should fail to decrypt with different key', async () => {
      await service.initializeKey('user-1');
      const encrypted = await service.encrypt('secret');

      // Clear and init with different user
      service.clearKey();
      localStorage.clear();
      await service.initializeKey('user-2');

      await expectAsync(service.decrypt(encrypted)).toBeRejected();
    });
  });

  describe('clearKey', () => {
    it('should clear the crypto key', async () => {
      await service.initializeKey('test-user');
      expect(service.isInitialized()).toBe(true);

      service.clearKey();

      expect(service.isInitialized()).toBe(false);
    });

    it('should not clear the salt from localStorage', async () => {
      await service.initializeKey('test-user');
      const saltKey = 'gmail-crypto-salt-test-user';

      service.clearKey();

      expect(localStorage.getItem(saltKey)).toBeTruthy();
    });
  });

  describe('clearUserData', () => {
    it('should clear key and salt', async () => {
      await service.initializeKey('test-user');
      const saltKey = 'gmail-crypto-salt-test-user';
      expect(localStorage.getItem(saltKey)).toBeTruthy();

      service.clearUserData('test-user');

      expect(service.isInitialized()).toBe(false);
      expect(localStorage.getItem(saltKey)).toBeNull();
    });
  });

  describe('isInitialized', () => {
    it('should return false initially', () => {
      expect(service.isInitialized()).toBe(false);
    });

    it('should return true after initialization', async () => {
      await service.initializeKey('test-user');
      expect(service.isInitialized()).toBe(true);
    });

    it('should return false after clearKey', async () => {
      await service.initializeKey('test-user');
      service.clearKey();
      expect(service.isInitialized()).toBe(false);
    });
  });
});
