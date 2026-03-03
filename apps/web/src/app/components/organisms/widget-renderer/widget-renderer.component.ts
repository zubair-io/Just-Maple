import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TextComponent,
  StatComponent,
  IconComponent,
  BadgeComponent,
  ImageComponent,
  ProgressComponent,
  TimestampComponent,
  HrDividerComponent,
  LinkComponent,
  ListComponent,
  CheckboxComponent,
} from '../../atoms';
import type { TextSize, TextColor, TextWeight } from '../../atoms/text/text.component';
import type { StatSize } from '../../atoms/stat/stat.component';
import type { IconSize } from '../../atoms/icon/icon.component';
import type { BadgeColor } from '../../atoms/badge/badge.component';
import type { ImageFit } from '../../atoms/image/image.component';
import type { ProgressVariant } from '../../atoms/progress/progress.component';
import type { TimestampFormat } from '../../atoms/timestamp/timestamp.component';
import type { DividerSpacing } from '../../atoms/divider/divider.component';
import type { ListSize } from '../../atoms/list/list.component';

@Component({
  selector: 'app-widget-renderer',
  standalone: true,
  imports: [
    CommonModule,
    TextComponent,
    StatComponent,
    IconComponent,
    BadgeComponent,
    ImageComponent,
    ProgressComponent,
    TimestampComponent,
    HrDividerComponent,
    LinkComponent,
    ListComponent,
    CheckboxComponent,
  ],
  templateUrl: './widget-renderer.component.html',
  styleUrl: './widget-renderer.component.scss',
})
export class WidgetRendererComponent {
  readonly node = input.required<Record<string, unknown>>();
  readonly data = input<Record<string, unknown>>({});

  isLayout(): boolean {
    return 'layout' in this.node();
  }

  isAtom(): boolean {
    return 'atom' in this.node();
  }

  getAtomType(): string {
    return (this.node() as Record<string, unknown>)['atom'] as string;
  }

  getLayoutType(): string {
    return (this.node() as Record<string, unknown>)['layout'] as string;
  }

  getChildren(): Record<string, unknown>[] {
    return (
      ((this.node() as Record<string, unknown>)['children'] as Record<string, unknown>[]) || []
    );
  }

  getHeader(): string {
    return ((this.node() as Record<string, unknown>)['header'] as string) || '';
  }

  layoutClasses(): string {
    const n = this.node() as Record<string, unknown>;
    const layoutMap: Record<string, string> = {
      card: 'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]',
      stack: 'flex flex-col',
      row: 'flex flex-row',
      grid: 'grid',
    };

    const gapMap: Record<string, string> = {
      xs: 'gap-1',
      sm: 'gap-2',
      md: 'gap-3',
      lg: 'gap-4',
    };

    const alignMap: Record<string, string> = {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    };

    const paddingMap: Record<string, string> = {
      sm: 'p-2',
      md: 'p-4',
      lg: 'p-6',
    };

    const layout = n['layout'] as string;
    const classes = [layoutMap[layout] || ''];

    if (n['gap']) classes.push(gapMap[n['gap'] as string] || '');
    if (n['align']) classes.push(alignMap[n['align'] as string] || '');
    if (n['wrap']) classes.push('flex-wrap');

    if (layout === 'card') {
      const padding = (n['padding'] as string) || 'md';
      classes.push(paddingMap[padding] || 'p-4');
    } else if (n['padding']) {
      classes.push(paddingMap[n['padding'] as string] || '');
    }

    if (layout === 'grid' && n['columns']) {
      const colsMap: Record<number, string> = {
        1: 'grid-cols-1',
        2: 'grid-cols-2',
        3: 'grid-cols-3',
        4: 'grid-cols-4',
        5: 'grid-cols-5',
        6: 'grid-cols-6',
      };
      const cols = n['columns'] as number;
      classes.push(colsMap[cols] || 'grid-cols-1');
    }

    return classes.filter(Boolean).join(' ');
  }

  resolve(): unknown {
    const n = this.node() as Record<string, unknown>;
    const d = this.data();

    // 1. GET raw value
    const raw = n['bind'] ? this.getNestedValue(d, n['bind'] as string) : n['value'];

    // 2. MAP (lookup transform)
    const map = n['map'] as Record<string, unknown> | undefined;
    const mapped = map ? (map[String(raw)] ?? map['_default'] ?? raw) : raw;

    // 3. FORMAT (string interpolation)
    const format = n['format'] as string | undefined;
    const formatted = format ? format.replace('{value}', String(mapped)) : mapped;

    return formatted;
  }

  resolveString(): string {
    return String(this.resolve() ?? '');
  }

  resolveNumber(): number {
    const val = this.resolve();
    return typeof val === 'number' ? val : Number(val) || 0;
  }

  resolveBoolean(): boolean {
    const val = this.resolve();
    return val === true || val === 'true';
  }

  resolveStringArray(): string[] {
    const val = this.resolve();
    if (Array.isArray(val)) return val.map(String);
    const n = this.node() as Record<string, unknown>;
    if (Array.isArray(n['items'])) return n['items'] as string[];
    return [];
  }

  getNodeProp(prop: string): string {
    return ((this.node() as Record<string, unknown>)[prop] as string) || '';
  }

  getNodeBoolProp(prop: string): boolean {
    return ((this.node() as Record<string, unknown>)[prop] as boolean) || false;
  }

  getNodeNumberProp(prop: string): number {
    return ((this.node() as Record<string, unknown>)[prop] as number) || 0;
  }

  // Typed accessors for atom component inputs
  getTextSize(): TextSize {
    return (this.getNodeProp('size') as TextSize) || 'md';
  }
  getTextColor(): TextColor {
    return (this.getNodeProp('color') as TextColor) || 'main';
  }
  getTextWeight(): TextWeight {
    return (this.getNodeProp('weight') as TextWeight) || 'normal';
  }
  getStatSize(): StatSize {
    return (this.getNodeProp('size') as StatSize) || 'md';
  }
  getIconSize(): IconSize {
    return (this.getNodeProp('size') as IconSize) || 'md';
  }
  getBadgeColor(): BadgeColor {
    return (this.getNodeProp('color') as BadgeColor) || 'gray';
  }
  getImageFit(): ImageFit {
    return (this.getNodeProp('fit') as ImageFit) || 'cover';
  }
  getProgressVariant(): ProgressVariant {
    return (this.getNodeProp('variant') as ProgressVariant) || 'bar';
  }
  getTimestampFormat(): TimestampFormat {
    return (this.getNodeProp('format') as TimestampFormat) || 'datetime';
  }
  getDividerSpacing(): DividerSpacing {
    return (this.getNodeProp('spacing') as DividerSpacing) || 'md';
  }
  getListSize(): ListSize {
    return (this.getNodeProp('size') as ListSize) || 'md';
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }
}
