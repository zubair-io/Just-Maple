import { Component, input, output, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface FormField {
  key: string;
  path: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
  value: unknown;
  children?: FormField[];
  depth: number;
  isExpanded: boolean;
}

/**
 * JSON Form Builder Component
 * Auto-generates a form from JSON data structure (or schema if provided).
 * Recursively renders fields with appropriate input controls.
 */
@Component({
  selector: 'app-json-form-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './json-form-builder.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './json-form-builder.component.scss',
})
export class JsonFormBuilderComponent {
  readonly data = input<unknown>();
  readonly schema = input<unknown>();

  readonly dataChange = output<unknown>();

  readonly fields = signal<FormField[]>([]);

  private currentData: unknown = {};

  constructor() {
    effect(() => {
      const data = this.data();
      if (data !== undefined) {
        this.currentData = structuredClone(data);
        this.fields.set(this.buildFields(data, '', 0));
      }
    });
  }

  private buildFields(data: unknown, parentPath: string, depth: number): FormField[] {
    if (depth > 10) return []; // Max nesting depth

    if (data === null || data === undefined) {
      return [];
    }

    if (typeof data !== 'object') {
      return [];
    }

    if (Array.isArray(data)) {
      return data.map((item, index) => {
        const path = parentPath ? `${parentPath}[${index}]` : `[${index}]`;
        return this.buildField(String(index), path, item, depth);
      });
    }

    return Object.entries(data as Record<string, unknown>).map(([key, value]) => {
      const path = parentPath ? `${parentPath}.${key}` : key;
      return this.buildField(key, path, value, depth);
    });
  }

  private buildField(key: string, path: string, value: unknown, depth: number): FormField {
    const type = this.getType(value);
    const children =
      type === 'object' || type === 'array' ? this.buildFields(value, path, depth + 1) : undefined;

    return {
      key,
      path,
      type,
      value,
      children,
      depth,
      isExpanded: depth < 2, // Auto-expand first 2 levels
    };
  }

  private getType(value: unknown): FormField['type'] {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    const t = typeof value;
    if (t === 'string') return 'string';
    if (t === 'number') return 'number';
    if (t === 'boolean') return 'boolean';
    if (t === 'object') return 'object';
    return 'string';
  }

  toggleExpand(field: FormField): void {
    field.isExpanded = !field.isExpanded;
  }

  onFieldChange(field: FormField, newValue: unknown): void {
    this.setValueAtPath(this.currentData, field.path, newValue);
    this.dataChange.emit(structuredClone(this.currentData));
  }

  onStringChange(field: FormField, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.onFieldChange(field, value);
  }

  onNumberChange(field: FormField, event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.onFieldChange(field, isNaN(value) ? 0 : value);
  }

  onBooleanChange(field: FormField, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.onFieldChange(field, value);
  }

  addArrayItem(field: FormField): void {
    const arr = this.getValueAtPath(this.currentData, field.path);
    if (Array.isArray(arr)) {
      arr.push('');
      this.currentData = structuredClone(this.currentData);
      this.fields.set(this.buildFields(this.currentData, '', 0));
      this.dataChange.emit(structuredClone(this.currentData));
    }
  }

  removeArrayItem(field: FormField, index: number): void {
    const arr = this.getValueAtPath(this.currentData, field.path);
    if (Array.isArray(arr)) {
      arr.splice(index, 1);
      this.currentData = structuredClone(this.currentData);
      this.fields.set(this.buildFields(this.currentData, '', 0));
      this.dataChange.emit(structuredClone(this.currentData));
    }
  }

  addObjectKey(field: FormField): void {
    const obj = this.getValueAtPath(this.currentData, field.path);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const record = obj as Record<string, unknown>;
      let newKey = 'newKey';
      let counter = 1;
      while (newKey in record) {
        newKey = `newKey${counter++}`;
      }
      record[newKey] = '';
      this.currentData = structuredClone(this.currentData);
      this.fields.set(this.buildFields(this.currentData, '', 0));
      this.dataChange.emit(structuredClone(this.currentData));
    }
  }

  removeObjectKey(field: FormField): void {
    const pathParts = field.path.split('.');
    const key = pathParts.pop();
    const parentPath = pathParts.join('.');

    if (!key) return;

    const parent = parentPath
      ? this.getValueAtPath(this.currentData, parentPath)
      : this.currentData;

    if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
      delete (parent as Record<string, unknown>)[key];
      this.currentData = structuredClone(this.currentData);
      this.fields.set(this.buildFields(this.currentData, '', 0));
      this.dataChange.emit(structuredClone(this.currentData));
    }
  }

  setNullToType(field: FormField, type: string): void {
    let value: unknown;
    switch (type) {
      case 'string':
        value = '';
        break;
      case 'number':
        value = 0;
        break;
      case 'boolean':
        value = false;
        break;
      case 'object':
        value = {};
        break;
      case 'array':
        value = [];
        break;
      default:
        value = '';
    }
    this.onFieldChange(field, value);
    this.currentData = structuredClone(this.currentData);
    this.fields.set(this.buildFields(this.currentData, '', 0));
  }

  private setValueAtPath(obj: unknown, path: string, value: unknown): void {
    const segments = path
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);

    let current: unknown = obj;
    for (let i = 0; i < segments.length - 1; i++) {
      if (current === null || current === undefined || typeof current !== 'object') return;
      if (Array.isArray(current)) {
        current = current[parseInt(segments[i], 10)];
      } else {
        current = (current as Record<string, unknown>)[segments[i]];
      }
    }

    const lastSegment = segments[segments.length - 1];
    if (current && typeof current === 'object') {
      if (Array.isArray(current)) {
        current[parseInt(lastSegment, 10)] = value;
      } else {
        (current as Record<string, unknown>)[lastSegment] = value;
      }
    }
  }

  private getValueAtPath(obj: unknown, path: string): unknown {
    if (!path) return obj;

    const segments = path
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);

    let current: unknown = obj;
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      if (Array.isArray(current)) {
        current = current[parseInt(segment, 10)];
      } else {
        current = (current as Record<string, unknown>)[segment];
      }
    }
    return current;
  }
}
