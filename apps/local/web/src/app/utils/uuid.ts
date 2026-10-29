/**
 * Generate a UUID v4 string.
 * Falls back to a manual implementation when crypto.randomUUID()
 * is unavailable (e.g. WKWebView in non-secure contexts).
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback using crypto.getRandomValues (available in WKWebView)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version 4 (0100) and variant 10xx bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
