import {
  Component,
  input,
  output,
  signal,
  computed,
  ElementRef,
  inject,
  afterNextRender,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { TodoPriority, TodoColor } from '@maple/shared';
import type { EnhancedTaskItemAttrs } from '../../organisms/notebook-editor/extensions';

export interface TodoPopoverPosition {
  top: number;
  left: number;
}

@Component({
  selector: 'app-todo-popover',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './todo-popover.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './todo-popover.component.scss',
})
export class TodoPopoverComponent {
  @ViewChild('dateInput') dateInputRef?: ElementRef<HTMLInputElement>;

  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly todoId = input.required<string>();
  readonly attrs = input.required<EnhancedTaskItemAttrs>();
  readonly position = input.required<DOMRect>();

  // Outputs
  readonly attrsChange = output<Partial<Omit<EnhancedTaskItemAttrs, 'id'>>>();
  readonly close = output<void>();

  // Local state for date input (natural language)
  readonly dateInputValue = signal('');

  // Priority options
  readonly priorities: { value: TodoPriority | null; label: string }[] = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  // Color options with hex values
  readonly colors: { value: TodoColor; hex: string; label: string }[] = [
    { value: 'red', hex: '#EF4444', label: 'Red' },
    { value: 'orange', hex: '#F97316', label: 'Orange' },
    { value: 'yellow', hex: '#EAB308', label: 'Yellow' },
    { value: 'green', hex: '#22C55E', label: 'Green' },
    { value: 'blue', hex: '#3B82F6', label: 'Blue' },
  ];

  // Computed styles for positioning
  readonly popoverStyle = computed(() => {
    const pos = this.position();
    return {
      top: `${pos.bottom + 8}px`,
      left: `${pos.left}px`,
    };
  });

  // Computed values from attrs
  readonly currentPriority = computed(() => this.attrs().priority);
  readonly currentColor = computed(() => this.attrs().color);
  readonly currentDueDate = computed(() => this.attrs().dueDate);

  // Format the due date for display
  readonly formattedDueDate = computed(() => {
    const dueDate = this.currentDueDate();
    if (!dueDate) return '';
    const date = new Date(dueDate);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  });

  constructor() {
    // Initialize date input with current due date
    afterNextRender(() => {
      const dueDate = this.currentDueDate();
      if (dueDate) {
        const date = new Date(dueDate);
        this.dateInputValue.set(date.toISOString().split('T')[0]);
      }
    });
  }

  /**
   * Set todo priority
   */
  setPriority(priority: TodoPriority | null): void {
    this.attrsChange.emit({ priority: priority || undefined });
  }

  /**
   * Set todo color
   */
  setColor(color: TodoColor | null): void {
    this.attrsChange.emit({ color: color || undefined });
  }

  /**
   * Parse and set due date from natural language input
   */
  setDueDate(value: string): void {
    if (!value.trim()) {
      this.attrsChange.emit({ dueDate: undefined });
      return;
    }

    const date = this.parseNaturalDate(value);
    if (date) {
      this.attrsChange.emit({ dueDate: date.toISOString() });
      this.dateInputValue.set(value);
    }
  }

  /**
   * Handle date input from native date picker
   */
  onDateInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      const date = new Date(input.value + 'T00:00:00');
      this.attrsChange.emit({ dueDate: date.toISOString() });
      this.dateInputValue.set(input.value);
    } else {
      this.attrsChange.emit({ dueDate: undefined });
      this.dateInputValue.set('');
    }
  }

  /**
   * Clear due date
   */
  clearDueDate(): void {
    this.attrsChange.emit({ dueDate: undefined });
    this.dateInputValue.set('');
  }

  /**
   * Clear priority
   */
  clearPriority(): void {
    this.attrsChange.emit({ priority: undefined });
  }

  /**
   * Clear color
   */
  clearColor(): void {
    this.attrsChange.emit({ color: undefined });
  }

  /**
   * Close the popover
   */
  onClose(): void {
    this.close.emit();
  }

  /**
   * Get Tailwind classes for priority buttons
   */
  readonly priorityClasses = computed(() => {
    const priority = this.currentPriority();
    const inactiveClass =
      'border-[var(--color-border)] bg-transparent text-[var(--color-text-main)] hover:bg-[var(--color-hover)]';
    const activeClasses: Record<string, string> = {
      high: 'border-transparent bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
      medium:
        'border-transparent bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
      low: 'border-transparent bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    };

    return {
      high: priority === 'high' ? activeClasses['high'] : inactiveClass,
      medium: priority === 'medium' ? activeClasses['medium'] : inactiveClass,
      low: priority === 'low' ? activeClasses['low'] : inactiveClass,
      null:
        priority === null || priority === undefined
          ? 'border-[var(--color-border)] bg-transparent text-[var(--color-text-main)]'
          : inactiveClass,
    } as Record<string, string>;
  });

  /**
   * Parse natural language date input
   * Supports: "today", "tomorrow", "next week", "in X days", day names, dates
   */
  private parseNaturalDate(input: string): Date | null {
    const normalizedInput = input.toLowerCase().trim();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Today
    if (normalizedInput === 'today') {
      return today;
    }

    // Tomorrow
    if (normalizedInput === 'tomorrow' || normalizedInput === 'tmr') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }

    // Next week
    if (normalizedInput === 'next week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return nextWeek;
    }

    // In X days (e.g., "in 3 days", "in 1 day")
    const inDaysMatch = normalizedInput.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1], 10);
      const future = new Date(today);
      future.setDate(future.getDate() + days);
      return future;
    }

    // Day names (e.g., "monday", "next friday")
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const nextDayMatch = normalizedInput.match(/(?:next\s+)?(\w+day)/);
    if (nextDayMatch) {
      const dayName = nextDayMatch[1].toLowerCase();
      const dayIndex = dayNames.indexOf(dayName);
      if (dayIndex !== -1) {
        const currentDay = today.getDay();
        let daysUntil = dayIndex - currentDay;
        if (daysUntil <= 0 || normalizedInput.startsWith('next')) {
          daysUntil += 7;
        }
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + daysUntil);
        return targetDate;
      }
    }

    // ISO date format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedInput)) {
      return new Date(normalizedInput + 'T00:00:00');
    }

    // Short date formats (e.g., "1/15", "jan 15", "january 15th")
    const monthNames = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const fullMonthNames = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];

    // Month day format (e.g., "jan 15", "january 15th")
    const monthDayMatch = normalizedInput.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/);
    if (monthDayMatch) {
      const monthStr = monthDayMatch[1].toLowerCase();
      const day = parseInt(monthDayMatch[2], 10);
      let monthIndex = monthNames.indexOf(monthStr.slice(0, 3));
      if (monthIndex === -1) {
        monthIndex = fullMonthNames.indexOf(monthStr);
      }
      if (monthIndex !== -1 && day >= 1 && day <= 31) {
        const targetDate = new Date(today.getFullYear(), monthIndex, day);
        // If date is in the past, assume next year
        if (targetDate < today) {
          targetDate.setFullYear(targetDate.getFullYear() + 1);
        }
        return targetDate;
      }
    }

    // Slash date format (e.g., "1/15", "01/15")
    const slashMatch = normalizedInput.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (slashMatch) {
      const month = parseInt(slashMatch[1], 10) - 1; // 0-indexed
      const day = parseInt(slashMatch[2], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const targetDate = new Date(today.getFullYear(), month, day);
        if (targetDate < today) {
          targetDate.setFullYear(targetDate.getFullYear() + 1);
        }
        return targetDate;
      }
    }

    // Try parsing as a date directly
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }
}
