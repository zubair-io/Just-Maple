import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Page, TodoIndex, TodoQueryResult, TodoPriority, TodoColor } from '@maple/shared';

type TodoFilter = 'all' | 'overdue' | 'today' | 'week' | 'no-date';
type TodoSort = 'due-date' | 'priority' | 'alpha';
type TodoGroupBy = 'due-date' | 'memo' | 'priority' | 'color' | 'none';

interface GroupedTodos {
  label: string;
  todos: TodoQueryResult[];
}

@Component({
  selector: 'app-todos-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './todos-view.component.html',
  styleUrl: './todos-view.component.scss',
})
export class TodosViewComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // State
  readonly isLoading = signal(true);
  readonly pages = signal<Page[]>([]);
  readonly filter = signal<TodoFilter>('all');
  readonly sort = signal<TodoSort>('due-date');
  readonly groupBy = signal<TodoGroupBy>('due-date');
  readonly priorityFilter = signal<TodoPriority | null>(null);
  readonly colorFilter = signal<TodoColor | null>(null);
  readonly showCompleted = signal(false);

  // Filter options
  readonly filterOptions: { value: TodoFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'no-date', label: 'No Date' },
  ];

  readonly sortOptions: { value: TodoSort; label: string }[] = [
    { value: 'due-date', label: 'Due Date' },
    { value: 'priority', label: 'Priority' },
    { value: 'alpha', label: 'Alphabetical' },
  ];

  readonly groupByOptions: { value: TodoGroupBy; label: string }[] = [
    { value: 'due-date', label: 'Due Date' },
    { value: 'memo', label: 'Memo' },
    { value: 'priority', label: 'Priority' },
    { value: 'color', label: 'Color' },
    { value: 'none', label: 'None' },
  ];

  readonly priorityOptions: { value: TodoPriority | null; label: string }[] = [
    { value: null, label: 'Any Priority' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  readonly colorOptions: { value: TodoColor | null; label: string; hex: string }[] = [
    { value: null, label: 'Any Color', hex: 'transparent' },
    { value: 'red', label: 'Red', hex: '#EF4444' },
    { value: 'orange', label: 'Orange', hex: '#F97316' },
    { value: 'yellow', label: 'Yellow', hex: '#EAB308' },
    { value: 'green', label: 'Green', hex: '#22C55E' },
    { value: 'blue', label: 'Blue', hex: '#3B82F6' },
  ];

  // Computed: all todos across all pages
  readonly allTodos = computed<TodoQueryResult[]>(() => {
    const pagesData = this.pages();
    const todos: TodoQueryResult[] = [];

    for (const page of pagesData) {
      if (page.todoMeta?.todos) {
        for (const todo of page.todoMeta.todos) {
          todos.push({
            ...todo,
            memoId: page.id,
            memoTitle: page.title || 'Untitled',
          });
        }
      }
    }

    return todos;
  });

  // Computed: filtered todos
  readonly filteredTodos = computed<TodoQueryResult[]>(() => {
    let todos = this.allTodos();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    // Filter by completion status
    if (!this.showCompleted()) {
      todos = todos.filter((t) => !t.checked);
    }

    // Apply date filter
    const filterValue = this.filter();
    switch (filterValue) {
      case 'overdue':
        todos = todos.filter((t) => !t.checked && t.dueDate && new Date(t.dueDate) < today);
        break;
      case 'today':
        todos = todos.filter((t) => {
          if (!t.dueDate) return false;
          const dueDate = new Date(t.dueDate);
          return (
            dueDate.getFullYear() === today.getFullYear() &&
            dueDate.getMonth() === today.getMonth() &&
            dueDate.getDate() === today.getDate()
          );
        });
        break;
      case 'week':
        todos = todos.filter((t) => {
          if (!t.dueDate) return false;
          const dueDate = new Date(t.dueDate);
          return dueDate >= today && dueDate < endOfWeek;
        });
        break;
      case 'no-date':
        todos = todos.filter((t) => !t.dueDate);
        break;
    }

    // Apply priority filter
    const priorityValue = this.priorityFilter();
    if (priorityValue) {
      todos = todos.filter((t) => t.priority === priorityValue);
    }

    // Apply color filter
    const colorValue = this.colorFilter();
    if (colorValue) {
      todos = todos.filter((t) => t.color === colorValue);
    }

    return todos;
  });

  // Computed: sorted todos
  readonly sortedTodos = computed<TodoQueryResult[]>(() => {
    const todos = [...this.filteredTodos()];
    const sortValue = this.sort();

    switch (sortValue) {
      case 'due-date':
        return todos.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
      case 'priority':
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return todos.sort((a, b) => {
          const aPriority = a.priority ? priorityOrder[a.priority] : 3;
          const bPriority = b.priority ? priorityOrder[b.priority] : 3;
          return aPriority - bPriority;
        });
      case 'alpha':
        return todos.sort((a, b) => a.text.localeCompare(b.text));
      default:
        return todos;
    }
  });

  // Computed: grouped todos
  readonly groupedTodos = computed<GroupedTodos[]>(() => {
    const todos = this.sortedTodos();
    const groupByValue = this.groupBy();

    if (groupByValue === 'none') {
      return [{ label: '', todos }];
    }

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
            const dueDate = new Date(todo.dueDate);
            if (dueDate < today) {
              groupKey = 'Overdue';
            } else if (this.isSameDay(dueDate, today)) {
              groupKey = 'Today';
            } else if (this.isSameDay(dueDate, tomorrow)) {
              groupKey = 'Tomorrow';
            } else if (dueDate < endOfWeek) {
              groupKey = 'This Week';
            } else {
              groupKey = 'Later';
            }
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

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(todo);
    }

    // Define group order for date-based grouping
    if (groupByValue === 'due-date') {
      const dateGroupOrder = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'No Date'];
      const orderedGroups: GroupedTodos[] = [];
      for (const key of dateGroupOrder) {
        if (groups.has(key)) {
          orderedGroups.push({ label: key, todos: groups.get(key)! });
        }
      }
      return orderedGroups;
    }

    // Define group order for priority-based grouping
    if (groupByValue === 'priority') {
      const priorityGroupOrder = ['High', 'Medium', 'Low', 'No Priority'];
      const orderedGroups: GroupedTodos[] = [];
      for (const key of priorityGroupOrder) {
        if (groups.has(key)) {
          orderedGroups.push({ label: key, todos: groups.get(key)! });
        }
      }
      return orderedGroups;
    }

    return Array.from(groups.entries()).map(([label, todos]) => ({ label, todos }));
  });

  // Computed: stats
  readonly stats = computed(() => {
    const todos = this.allTodos();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const total = todos.length;
    const completed = todos.filter((t) => t.checked).length;
    const overdue = todos.filter(
      (t) => !t.checked && t.dueDate && new Date(t.dueDate) < today,
    ).length;

    return { total, completed, overdue, incomplete: total - completed };
  });

  async ngOnInit(): Promise<void> {
    await this.loadPages();
  }

  async loadPages(): Promise<void> {
    this.isLoading.set(true);

    try {
      // Get notebookId from route
      const notebookId = this.route.snapshot.paramMap.get('notebookId');
      const url = notebookId
        ? `/api/pages?notebookId=${notebookId}&hasTodos=true`
        : '/api/pages?hasTodos=true';

      const response = await firstValueFrom(this.http.get<{ pages: Page[] }>(url));
      this.pages.set(response.pages || []);
    } catch (error) {
      console.error('[TodosView] Failed to load pages:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  // Navigate to a specific todo in a memo
  navigateToTodo(todo: TodoQueryResult): void {
    const notebookId = this.route.snapshot.paramMap.get('notebookId');
    const path = notebookId ? ['/', notebookId, todo.memoId] : ['/', 'default', todo.memoId];

    this.router.navigate(path, {
      fragment: `todo-${todo.id}`,
    });
  }

  // Toggle todo completion
  async toggleTodo(todo: TodoQueryResult, event: Event): Promise<void> {
    event.stopPropagation();

    // Optimistic update
    const pages = this.pages();
    const updatedPages = pages.map((page) => {
      if (page.id !== todo.memoId || !page.todoMeta) return page;

      const updatedTodos = page.todoMeta.todos.map((t) =>
        t.id === todo.id ? { ...t, checked: !t.checked } : t,
      );

      const completedCount = updatedTodos.filter((t) => t.checked).length;

      return {
        ...page,
        todoMeta: {
          ...page.todoMeta,
          todos: updatedTodos,
          completedCount,
        },
      };
    });

    this.pages.set(updatedPages);

    // Sync to server
    try {
      const page = pages.find((p) => p.id === todo.memoId);
      if (page?.todoMeta) {
        const updatedMeta = {
          ...page.todoMeta,
          todos: page.todoMeta.todos.map((t) =>
            t.id === todo.id ? { ...t, checked: !t.checked } : t,
          ),
        };
        updatedMeta.completedCount = updatedMeta.todos.filter((t) => t.checked).length;

        await firstValueFrom(
          this.http.patch(`/api/pages/${todo.memoId}`, { todoMeta: updatedMeta }),
        );
      }
    } catch (error) {
      console.error('[TodosView] Failed to toggle todo:', error);
      // Revert on error
      this.pages.set(pages);
    }
  }

  // Filter methods
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

  // Helper: check if two dates are the same day
  private isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  // Format due date for display
  formatDueDate(dueDate: string | undefined): string {
    if (!dueDate) return '';
    const date = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (this.isSameDay(date, today)) {
      return 'Today';
    } else if (this.isSameDay(date, tomorrow)) {
      return 'Tomorrow';
    } else if (date < today) {
      const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      return `${diffDays}d overdue`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  // Check if a todo is overdue
  isOverdue(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    const date = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date < today;
  }
}
