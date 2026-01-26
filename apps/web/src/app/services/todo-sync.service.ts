import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Editor } from '@tiptap/core';
import type { PageTodoMeta, TodoIndex } from '@maple/shared';

/**
 * TodoSyncService
 * Extracts todo metadata from Tiptap editor and syncs to page collection
 */
@Injectable({ providedIn: 'root' })
export class TodoSyncService {
  private readonly http = inject(HttpClient);

  // Debounce timers per page
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Debounce delay in ms
  private readonly SYNC_DELAY = 500;

  /**
   * Extract all todos from the editor document
   */
  extractTodos(editor: Editor): TodoIndex[] {
    const todos: TodoIndex[] = [];

    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem') {
        const id = node.attrs['id'];
        if (id) {
          todos.push({
            id,
            text: node.textContent.slice(0, 100),
            checked: node.attrs['checked'] || false,
            dueDate: node.attrs['dueDate'] || undefined,
            priority: node.attrs['priority'] || undefined,
            color: node.attrs['color'] || undefined,
          });
        }
      }
      return true;
    });

    return todos;
  }

  /**
   * Compute todo metadata from the list of todos
   */
  computeTodoMeta(todos: TodoIndex[]): PageTodoMeta {
    const now = new Date().toISOString();
    let nextDueDate: string | undefined = undefined;
    let overdueCount = 0;
    let completedCount = 0;

    for (const todo of todos) {
      if (todo.checked) {
        completedCount++;
      } else if (todo.dueDate) {
        // Check for overdue
        if (todo.dueDate < now) {
          overdueCount++;
        }
        // Track next due date (earliest incomplete due date)
        if (!nextDueDate || todo.dueDate < nextDueDate) {
          nextDueDate = todo.dueDate;
        }
      }
    }

    return {
      todoCount: todos.length,
      completedCount,
      hasTodos: todos.length > 0,
      nextDueDate,
      overdueCount,
      todos,
    };
  }

  /**
   * Sync todo metadata from editor to page collection
   * Debounced to avoid excessive API calls
   */
  syncTodoMeta(pageId: string, editor: Editor): void {
    // Clear existing timer for this page
    const existingTimer = this.debounceTimers.get(pageId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(pageId);

      const todos = this.extractTodos(editor);
      const todoMeta = this.computeTodoMeta(todos);

      try {
        await firstValueFrom(this.http.patch(`/api/pages/${pageId}`, { todoMeta }));
      } catch (error) {
        console.error('[TodoSyncService] Failed to sync todo metadata:', error);
      }
    }, this.SYNC_DELAY);

    this.debounceTimers.set(pageId, timer);
  }

  /**
   * Immediately sync todo metadata (no debounce)
   * Use this when you need to ensure sync before navigation
   */
  async syncTodoMetaImmediate(pageId: string, editor: Editor): Promise<void> {
    // Clear any pending timer
    const existingTimer = this.debounceTimers.get(pageId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(pageId);
    }

    const todos = this.extractTodos(editor);
    const todoMeta = this.computeTodoMeta(todos);

    await firstValueFrom(this.http.patch(`/api/pages/${pageId}`, { todoMeta }));
  }

  /**
   * Clear any pending sync timers
   */
  clearPendingSync(pageId: string): void {
    const timer = this.debounceTimers.get(pageId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(pageId);
    }
  }
}
