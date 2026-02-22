import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import {
  TodoService,
  type TodoFilter,
  type TodoSort,
  type TodoGroupBy,
} from '../../services/todo.service';
import type { TodoQueryResult, TodoPriority, TodoColor } from '@maple/shared';

@Component({
  selector: 'app-todos-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './todos-view.component.html',
  styleUrl: './todos-view.component.scss',
})
export class TodosViewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly todoService = inject(TodoService);

  // Delegate signals to service
  readonly isLoading = this.todoService.isLoading;
  readonly filter = this.todoService.filter;
  readonly sort = this.todoService.sort;
  readonly groupBy = this.todoService.groupBy;
  readonly priorityFilter = this.todoService.priorityFilter;
  readonly colorFilter = this.todoService.colorFilter;
  readonly showCompleted = this.todoService.showCompleted;
  readonly groupedTodos = this.todoService.groupedTodos;
  readonly sortedTodos = this.todoService.sortedTodos;
  readonly stats = this.todoService.stats;

  // Filter options (UI-only, stay in component)
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

  ngOnInit(): void {
    const notebookId = this.route.snapshot.paramMap.get('notebookId') ?? undefined;
    this.todoService.loadPages(notebookId).subscribe();
  }

  navigateToTodo(todo: TodoQueryResult): void {
    const notebookId = this.route.snapshot.paramMap.get('notebookId');
    const path = notebookId ? ['/', notebookId, todo.memoId] : ['/', 'default', todo.memoId];

    this.router.navigate(path, {
      fragment: `todo-${todo.id}`,
    });
  }

  toggleTodo(todo: TodoQueryResult, event: Event): void {
    event.stopPropagation();
    this.todoService.toggleTodo(todo).subscribe();
  }

  // Delegate filter/sort/group methods
  setFilter(filter: TodoFilter): void {
    this.todoService.setFilter(filter);
  }

  setSort(sort: TodoSort): void {
    this.todoService.setSort(sort);
  }

  setGroupBy(groupBy: TodoGroupBy): void {
    this.todoService.setGroupBy(groupBy);
  }

  setPriorityFilter(priority: TodoPriority | null): void {
    this.todoService.setPriorityFilter(priority);
  }

  setColorFilter(color: TodoColor | null): void {
    this.todoService.setColorFilter(color);
  }

  toggleShowCompleted(): void {
    this.todoService.toggleShowCompleted();
  }

  // Delegate utility methods
  formatDueDate(dueDate: string | undefined): string {
    return this.todoService.formatDueDate(dueDate);
  }

  isOverdue(dueDate: string | undefined): boolean {
    return this.todoService.isOverdue(dueDate);
  }

  getPriorityBadgeClasses(priority: TodoPriority): string {
    return this.todoService.getPriorityBadgeClasses(priority);
  }
}
