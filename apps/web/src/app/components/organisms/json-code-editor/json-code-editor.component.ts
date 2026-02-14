import {
  Component,
  ElementRef,
  ViewChild,
  input,
  output,
  signal,
  effect,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * JSON Code Editor Component
 * Textarea-based JSON editor with syntax validation and formatting.
 * Provides a clean editing experience for raw JSON data.
 */
@Component({
  selector: 'app-json-code-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './json-code-editor.component.html',
  styleUrl: './json-code-editor.component.scss',
})
export class JsonCodeEditorComponent implements OnDestroy {
  readonly data = input<unknown>();
  readonly schema = input<unknown>();
  readonly readonly = input(false);

  readonly dataChange = output<unknown>();

  readonly jsonText = signal('{}');
  readonly validationError = signal<string | null>(null);
  readonly lineCount = signal(1);

  @ViewChild('editor') editorRef?: ElementRef<HTMLTextAreaElement>;

  private saveTimeout?: ReturnType<typeof setTimeout>;
  private isExternalUpdate = false;

  constructor() {
    // Sync data input to text
    effect(() => {
      const data = this.data();
      if (data !== undefined) {
        this.isExternalUpdate = true;
        try {
          const formatted = JSON.stringify(data, null, 4);
          this.jsonText.set(formatted);
          this.lineCount.set(formatted.split('\n').length);
          this.validationError.set(null);
        } catch {
          this.jsonText.set(String(data));
        }
        this.isExternalUpdate = false;
      }
    });
  }

  onTextChange(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.jsonText.set(text);
    this.lineCount.set(text.split('\n').length);

    // Validate JSON
    try {
      JSON.parse(text);
      this.validationError.set(null);
    } catch (err: any) {
      this.validationError.set(err.message || 'Invalid JSON');
      return;
    }

    // Debounce save
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const parsed = JSON.parse(text);
        this.dataChange.emit(parsed);
      } catch {
        // Already handled above
      }
    }, 800);
  }

  formatJson(): void {
    try {
      const parsed = JSON.parse(this.jsonText());
      const formatted = JSON.stringify(parsed, null, 4);
      this.jsonText.set(formatted);
      this.lineCount.set(formatted.split('\n').length);
      this.validationError.set(null);

      // Update the textarea
      if (this.editorRef) {
        this.editorRef.nativeElement.value = formatted;
      }
    } catch {
      // Can't format invalid JSON
    }
  }

  onKeydown(event: KeyboardEvent): void {
    // Ctrl+S / Cmd+S to save immediately
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      try {
        const parsed = JSON.parse(this.jsonText());
        this.dataChange.emit(parsed);
      } catch {
        // Invalid JSON, don't save
      }
    }

    // Tab key inserts spaces instead of switching focus
    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = event.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = value.substring(0, start) + '    ' + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;

      // Trigger change
      this.onTextChange(event as any);
    }
  }

  onScroll(event: Event): void {
    // Sync line numbers scroll with textarea
    const textarea = event.target as HTMLTextAreaElement;
    const lineNumbers = textarea.parentElement?.querySelector('.line-numbers');
    if (lineNumbers) {
      (lineNumbers as HTMLElement).scrollTop = textarea.scrollTop;
    }
  }

  ngOnDestroy(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
  }
}
