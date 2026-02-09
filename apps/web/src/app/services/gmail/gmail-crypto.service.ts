import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Service for encrypting/decrypting Gmail OAuth tokens using Web Crypto API.
 * Tokens are encrypted using AES-GCM with a key derived from the user's session.
 *
 * SECURITY: This provides encryption-at-rest for OAuth tokens stored in IndexedDB.
 * The encryption key is derived from a combination of the user's ID and a random salt.
 */
@Injectable({ providedIn: 'root' })
export class GmailCryptoService {
  private readonly platformId = inject(PLATFORM_ID);
  private cryptoKey: CryptoKey | null = null;
  private readonly ALGORITHM = 'AES-GCM';
  private readonly KEY_LENGTH = 256;

  /**
   * Initialize the encryption key for the current user session.
   * Must be called after user authentication.
   */
  async initializeKey(userId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    // Get or create a salt for this user (stored in localStorage, not sensitive)
    const saltKey = `gmail-crypto-salt-${userId}`;
    let saltHex = localStorage.getItem(saltKey);
    let salt: Uint8Array;

    if (!saltHex) {
      // Generate new random salt
      salt = crypto.getRandomValues(new Uint8Array(16));
      saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      localStorage.setItem(saltKey, saltHex);
    } else {
      // Parse existing salt
      const hexPairs = saltHex.match(/.{2}/g);
      if (!hexPairs || hexPairs.length !== 16) {
        // Salt is corrupted — regenerate
        salt = crypto.getRandomValues(new Uint8Array(16));
        saltHex = Array.from(salt)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        localStorage.setItem(saltKey, saltHex);
      } else {
        salt = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));
      }
    }

    // Derive key from userId + salt using PBKDF2
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(userId),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey'],
    );

    this.cryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt a string value (e.g., OAuth token).
   * Returns a base64-encoded string containing IV + ciphertext.
   */
  async encrypt(plaintext: string): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Encryption not available in this environment');
    }
    if (!this.cryptoKey) {
      throw new Error('Crypto key not initialized. Call initializeKey() first.');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: this.ALGORITHM, iv },
      this.cryptoKey,
      data,
    );

    // Combine IV + ciphertext into single buffer
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // Return as base64 string
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt a previously encrypted value.
   * Expects a base64-encoded string containing IV + ciphertext.
   */
  async decrypt(encrypted: string): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Decryption not available in this environment');
    }
    if (!this.cryptoKey) {
      throw new Error('Crypto key not initialized. Call initializeKey() first.');
    }

    // Decode base64
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: this.ALGORITHM, iv },
      this.cryptoKey,
      ciphertext,
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  }

  /**
   * Check if the crypto key has been initialized.
   */
  isInitialized(): boolean {
    return this.cryptoKey !== null;
  }

  /**
   * Clear the crypto key (e.g., on logout).
   */
  clearKey(): void {
    this.cryptoKey = null;
  }

  /**
   * Clear all encryption data for a user (including salt).
   * Call this when user disconnects Gmail.
   */
  clearUserData(userId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(`gmail-crypto-salt-${userId}`);
    this.cryptoKey = null;
  }
}
