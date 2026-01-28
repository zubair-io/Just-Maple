import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

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
  private readonly http = inject(HttpClient);

  // Signals for reactive state
  private readonly _uploading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly uploading = this._uploading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Upload an image to a memo
   * @param pageId - The page/memo ID
   * @param file - The image file to upload
   */
  uploadImage(pageId: string, file: File): Observable<MemoImageUploadResult> {
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this._error.set('Invalid file type. Only JPEG, PNG, GIF, and WebP images are supported.');
      return throwError(() => new Error('Invalid file type'));
    }

    // Validate file size (150MB limit)
    const maxSize = 150 * 1024 * 1024;
    if (file.size > maxSize) {
      this._error.set('Image file exceeds maximum size of 150MB');
      return throwError(() => new Error('File too large'));
    }

    this._uploading.set(true);
    this._error.set(null);

    return new Observable<MemoImageUploadResult>((subscriber) => {
      // Read file as ArrayBuffer
      const reader = new FileReader();
      reader.onloadend = () => {
        const arrayBuffer = reader.result as ArrayBuffer;

        this.http
          .post<MemoImageUploadResult>(`/api/memos/${pageId}/images`, arrayBuffer, {
            headers: {
              'Content-Type': file.type,
            },
          })
          .pipe(
            map((response) => response),
            catchError((err) => {
              const message = err?.error?.error || 'Failed to upload image';
              this._error.set(message);
              this._uploading.set(false);
              return throwError(() => new Error(message));
            }),
          )
          .subscribe({
            next: (result) => {
              this._uploading.set(false);
              subscriber.next(result);
              subscriber.complete();
            },
            error: (err) => {
              this._uploading.set(false);
              subscriber.error(err);
            },
          });
      };
      reader.onerror = () => {
        this._uploading.set(false);
        this._error.set('Failed to read image file');
        subscriber.error(new Error('Failed to read image file'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Delete an image from a memo
   * @param pageId - The page/memo ID
   * @param imageId - The image ID
   * @param urls - The image URLs (all size variants will be deleted)
   */
  deleteImage(pageId: string, imageId: string, urls: MemoImageUrls): Observable<void> {
    return this.http
      .delete(`/api/memos/${pageId}/images/${imageId}`, {
        body: { urls },
      })
      .pipe(
        map(() => undefined),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to delete image';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Clear any error
   */
  clearError(): void {
    this._error.set(null);
  }

  /**
   * Create a file input and trigger file selection
   * @returns Promise that resolves with the selected file or null if cancelled
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

      // Handle case where user closes dialog without selecting
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
