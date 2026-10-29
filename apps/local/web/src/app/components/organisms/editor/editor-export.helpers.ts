import type { NativeBridgeService } from '../../../services/native-bridge.service';

/**
 * Sanitize a string for use as a filename.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

/**
 * Download or share a file. Uses native share on iOS/macOS, browser download otherwise.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
  nativeBridge: NativeBridgeService,
): void {
  if (nativeBridge.isNativeApp()) {
    try {
      const bytes = new TextEncoder().encode(content);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const base64 = btoa(binary);
      nativeBridge.shareFile(filename, mimeType, base64);
      return;
    } catch (error) {
      console.error('[Editor] Failed to encode file for native share:', error);
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
