import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Tag, CreateTagInput, UpdateTagInput } from '@maple/shared';

@Injectable({
  providedIn: 'root',
})
export class TagService {
  private readonly http = inject(HttpClient);

  private readonly _tags = signal<Tag[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly tags = this._tags.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  async loadTags(): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(this.http.get<{ tags: Tag[] }>('/api/tags'));
      this._tags.set(response.tags);
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to load tags';
      this._error.set(message);
      // Don't throw - just set empty array
      this._tags.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  async createTag(data: CreateTagInput): Promise<Tag> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(this.http.post<{ tag: Tag }>('/api/tags', data));

      // Add to local state
      this._tags.update((tags) => [...tags, response.tag]);

      return response.tag;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to create tag';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async updateTag(id: string, data: UpdateTagInput): Promise<Tag> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(this.http.put<{ tag: Tag }>(`/api/tags/${id}`, data));

      // Update local state
      this._tags.update((tags) => tags.map((t) => (t._id === id ? response.tag : t)));

      return response.tag;
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to update tag';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  async deleteTag(id: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      await firstValueFrom(this.http.delete(`/api/tags/${id}`));

      // Remove from local state
      this._tags.update((tags) => tags.filter((t) => t._id !== id));
    } catch (err: any) {
      const message = err?.error?.error || 'Failed to delete tag';
      this._error.set(message);
      throw new Error(message);
    } finally {
      this._isLoading.set(false);
    }
  }

  getTagById(id: string): Tag | undefined {
    return this._tags().find((t) => t._id === id);
  }

  async ensureDefaultTag(): Promise<void> {
    // Load tags first if empty
    if (this._tags().length === 0) {
      await this.loadTags();
    }

    // Create default tag if still no tags
    if (this._tags().length === 0) {
      try {
        await this.createTag({ label: 'General' });
      } catch (err) {
        // Ignore error - might fail if tag already exists
        console.warn('Could not create default tag:', err);
      }
    }
  }
}
