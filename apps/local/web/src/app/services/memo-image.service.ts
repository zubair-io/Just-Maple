import { Injectable, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { generateUUID } from '../utils/uuid';

export interface MemoImageUrls {
  original: string;
  small: string;
  medium: string;
  large: string;
  cover: string;
}

export interface MemoImageUploadResult {
  id: string;
  urls: MemoImageUrls;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class MemoImageService {
  private readonly _uploading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly uploading = this._uploading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * "Upload" an image locally by creating a blob URL.
   * In a local-only app, images are stored as blob URLs for the session.
   * For persistent storage, the image data could be saved alongside the .md file.
   */
  uploadImage(_pageId: string, file: File): Observable<MemoImageUploadResult> {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this._error.set('Invalid file type. Only JPEG, PNG, GIF, and WebP images are supported.');
      return throwError(() => new Error('Invalid file type'));
    }

    const maxSize = 150 * 1024 * 1024;
    if (file.size > maxSize) {
      this._error.set('Image file exceeds maximum size of 150MB');
      return throwError(() => new Error('File too large'));
    }

    this._uploading.set(true);
    this._error.set(null);

    const blobUrl = URL.createObjectURL(file);
    const id = generateUUID();

    const result: MemoImageUploadResult = {
      id,
      urls: {
        original: blobUrl,
        small: blobUrl,
        medium: blobUrl,
        large: blobUrl,
        cover: blobUrl,
      },
      width: 0,
      height: 0,
    };

    this._uploading.set(false);
    return of(result);
  }

  /**
   * Delete an image (revoke blob URL)
   */
  deleteImage(_pageId: string, _imageId: string, urls: MemoImageUrls): Observable<void> {
    try {
      URL.revokeObjectURL(urls.original);
    } catch {
      // Ignore errors revoking URLs
    }
    return of(undefined);
  }

  clearError(): void {
    this._error.set(null);
  }

  /**
   * Open file picker to select an image
   */
  selectImageFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/gif,image/webp';

      input.onchange = () => {
        const file = input.files?.[0] || null;
        resolve(file);
      };

      input.oncancel = () => {
        resolve(null);
      };

      const handleBlur = () => {
        setTimeout(() => {
          if (!input.files?.length) {
            resolve(null);
          }
          window.removeEventListener('focus', handleBlur);
        }, 300);
      };
      window.addEventListener('focus', handleBlur);

      input.click();
    });
  }
}
