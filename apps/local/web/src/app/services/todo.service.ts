import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, of } from 'rxjs';
import { PageService } from './page.service';
import type { Page, TodoQueryResult, TodoPriority, TodoColor } from '@maple/shared';

export type TodoFilter = 'all' | 'overdue' | 'today' | 'week' | 'no-date';
export type TodoSort = 'due-date' | 'priority' | 'alpha';
export type TodoGroupBy = 'due-date' | 'memo' | 'priority' | 'color' | 'none';

export interface GroupedTodos {
  label: string;
  todos: TodoQueryResult[];
}

@Injectable({ providedIn: 'root' })
export class TodoService {
  private readonly pageService = inject(PageService);

  readonly pages = signal<Page[]>([]);
  readonly isLoading = signal(false);

  readonly filter = signal<TodoFilter>('all');
  readonly sort = signal<TodoSort>('due-date');
  readonly groupBy = signal<TodoGroupBy>('due-date');
  readonly priorityFilter = signal<TodoPriority | null>(null);
  readonly colorFilter = signal<TodoColor | null>(null);
  readonly showCompleted = signal(false);

  readonly allTodos = computed<TodoQueryResult[]>(() => {
    const pagesData = this.pages();
    const todos: TodoQueryResult[] = [];
    for (const page of pagesData) {
      if (page.todoMeta?.todos) {
        for (const todo of page.todoMeta.todos) {
          todos.push({ ...todo, memoId: page.id, memoTitle: page.title || 'Untitled' });
        }
      }
    }
    return todos;
  });

  readonly filteredTodos = computed<TodoQueryResult[]>(() => {
    let todos = this.allTodos();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    if (!this.showCompleted()) {
      todos = todos.filter((t) => !t.checked);
    }

    switch (this.filter()) {
      case 'overdue':
        todos = todos.filter((t) => !t.checked && t.dueDate && new Date(t.dueDate) < today);
        break;
      case 'today':
        todos = todos.filter((t) => t.dueDate && this.isSameDay(new Date(t.dueDate), today));
        break;
      case 'week':
        todos = todos.filter((t) => {
          if (!t.dueDate) return false;
          const d = new Date(t.dueDate);
          return d >= today && d < endOfWeek;
        });
        break;
      case 'no-date':
        todos = todos.filter((t) => !t.dueDate);
        break;
    }

    const pf = this.priorityFilter();
    if (pf) todos = todos.filter((t) => t.priority === pf);
    const cf = this.colorFilter();
    if (cf) todos = todos.filter((t) => t.color === cf);

    return todos;
  });

  readonly sortedTodos = computed<TodoQueryResult[]>(() => {
    const todos = [...this.filteredTodos()];
    switch (this.sort()) {
      case 'due-date':
        return todos.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
      case 'priority': {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return todos.sort(
          (a, b) => (order[a.priority ?? ''] ?? 3) - (order[b.priority ?? ''] ?? 3),
        );
      }
      case 'alpha':
        return todos.sort((a, b) => a.text.localeCompare(b.text));
      default:
        return todos;
    }
  });

  readonly groupedTodos = computed<GroupedTodos[]>(() => {
    const todos = this.sortedTodos();
    const groupByValue = this.groupBy();
    if (groupByValue === 'none') return [{ label: '', todos }];

    const groups = new Map<string, TodoQueryResult[]>();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    for (const todo of todos) {
      let groupKey: string;
      switch (groupByValue) {
        case 'due-date':
          if (!todo.dueDate) {
            groupKey = 'No Date';
          } else {
            const d = new Date(todo.dueDate);
            if (d < today) groupKey = 'Overdue';
            else if (this.isSameDay(d, today)) groupKey = 'Today';
            else if (this.isSameDay(d, tomorrow)) groupKey = 'Tomorrow';
            else if (d < endOfWeek) groupKey = 'This Week';
            else groupKey = 'Later';
          }
          break;
        case 'memo':
          groupKey = todo.memoTitle;
          break;
        case 'priority':
          groupKey = todo.priority
            ? todo.priority.charAt(0).toUpperCase() + todo.priority.slice(1)
            : 'No Priority';
          break;
        case 'color':
          groupKey = todo.color
            ? todo.color.charAt(0).toUpperCase() + todo.color.slice(1)
            : 'No Color';
          break;
        default:
          groupKey = '';
      }
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(todo);
    }

    if (groupByValue === 'due-date') {
      const order = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'No Date'];
      return order.filter((k) => groups.has(k)).map((k) => ({ label: k, todos: groups.get(k)! }));
    }
    if (groupByValue === 'priority') {
      const order = ['High', 'Medium', 'Low', 'No Priority'];
      return order.filter((k) => groups.has(k)).map((k) => ({ label: k, todos: groups.get(k)! }));
    }
    return Array.from(groups.entries()).map(([label, todos]) => ({ label, todos }));
  });

  readonly stats = computed(() => {
    const todos = this.allTodos();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const total = todos.length;
    const completed = todos.filter((t) => t.checked).length;
    const overdue = todos.filter(
      (t) => !t.checked && t.dueDate && new Date(t.dueDate) < today,
    ).length;
    return { total, completed, overdue, incomplete: total - completed };
  });

  /** Load pages with todos from the local page store */
  loadPages(folderId?: string): Observable<Page[]> {
    this.isLoading.set(true);
    const allPages = this.pageService.pages();
    let filtered = allPages.filter((p: any) => p.todoMeta?.hasTodos);
    if (folderId) filtered = filtered.filter((p: any) => p.folderId === folderId);
    this.pages.set(filtered);
    this.isLoading.set(false);
    return of(filtered);
  }

  /** Toggle todo completion (local-only) */
  toggleTodo(todo: TodoQueryResult): Observable<void> {
    this.pages.update((pages) =>
      pages.map((page) => {
        if (page.id !== todo.memoId || !page.todoMeta) return page;
        const updatedTodos = page.todoMeta.todos.map((t) =>
          t.id === todo.id ? { ...t, checked: !t.checked } : t,
        );
        return {
          ...page,
          todoMeta: {
            ...page.todoMeta,
            todos: updatedTodos,
            completedCount: updatedTodos.filter((t) => t.checked).length,
          },
        };
      }),
    );
    return of(undefined);
  }

  setFilter(filter: TodoFilter): void {
    this.filter.set(filter);
  }
  setSort(sort: TodoSort): void {
    this.sort.set(sort);
  }
  setGroupBy(groupBy: TodoGroupBy): void {
    this.groupBy.set(groupBy);
  }
  setPriorityFilter(priority: TodoPriority | null): void {
    this.priorityFilter.set(priority);
  }
  setColorFilter(color: TodoColor | null): void {
    this.colorFilter.set(color);
  }
  toggleShowCompleted(): void {
    this.showCompleted.update((v) => !v);
  }

  isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  formatDueDate(dueDate: string | undefined): string {
    if (!dueDate) return '';
    const date = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (this.isSameDay(date, today)) return 'Today';
    if (this.isSameDay(date, tomorrow)) return 'Tomorrow';
    if (date < today)
      return `${Math.floor((today.getTime() - date.getTime()) / 86400000)}d overdue`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  isOverdue(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dueDate) < today;
  }

  getPriorityBadgeClasses(priority: TodoPriority): string {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
      case 'medium':
        return 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400';
      case 'low':
        return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-black/5 text-[var(--color-text-muted)]';
    }
  }
}
