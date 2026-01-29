import { Component, inject, input, output, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { Template } from '@maple/shared';
import { TemplateService } from '../../../services/template.service';
import { TemplateCardComponent } from '../../molecules/template-card/template-card.component';

type CategoryFilter = 'all' | 'work' | 'personal' | 'planning' | 'custom';

@Component({
  selector: 'app-template-gallery-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TemplateCardComponent],
  templateUrl: './template-gallery-modal.component.html',
  styleUrl: './template-gallery-modal.component.scss',
})
export class TemplateGalleryModalComponent implements OnInit {
  private readonly templateService = inject(TemplateService);

  readonly notebookId = input.required<string>();
  readonly notebookName = input<string>('');

  readonly closed = output<void>();
  readonly created = output<{ pageId: string }>();

  readonly templates = signal<Template[]>([]);
  readonly isLoading = signal(true);
  readonly isApplying = signal(false);
  readonly applyingTemplateId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly selectedCategory = signal<CategoryFilter>('all');
  readonly searchQuery = signal('');

  readonly categories: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'work', label: 'Work' },
    { value: 'personal', label: 'Personal' },
    { value: 'planning', label: 'Planning' },
    { value: 'custom', label: 'My Templates' },
  ];

  readonly filteredTemplates = computed(() => {
    let result = this.templates();
    const category = this.selectedCategory();
    const query = this.searchQuery().toLowerCase();

    if (category !== 'all') {
      result = result.filter((t) =>
        category === 'custom' ? !t.isSystem : t.category === category,
      );
    }

    if (query) {
      result = result.filter(
        (t) => t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query),
      );
    }

    return result;
  });

  readonly systemTemplates = computed(() => this.filteredTemplates().filter((t) => t.isSystem));

  readonly customTemplates = computed(() => this.filteredTemplates().filter((t) => !t.isSystem));

  async ngOnInit(): Promise<void> {
    await this.loadTemplates();
  }

  async loadTemplates(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);
      const templates = await firstValueFrom(this.templateService.fetchTemplates());
      this.templates.set(templates);
    } catch (err) {
      this.error.set('Failed to load templates');
      console.error('Error loading templates:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  async applyTemplate(template: Template): Promise<void> {
    try {
      this.isApplying.set(true);
      this.applyingTemplateId.set(template.id);
      this.error.set(null);

      const page = await firstValueFrom(
        this.templateService.applyTemplate(template.id, {
          notebookId: this.notebookId(),
          notebookName: this.notebookName(),
        }),
      );

      this.created.emit({ pageId: page.id });
    } catch (err) {
      this.error.set('Failed to create page from template');
      console.error('Error applying template:', err);
    } finally {
      this.isApplying.set(false);
      this.applyingTemplateId.set(null);
    }
  }

  async deleteTemplate(template: Template): Promise<void> {
    if (template.isSystem) return;

    try {
      await firstValueFrom(this.templateService.deleteTemplate(template.id));
      this.templates.update((templates) => templates.filter((t) => t.id !== template.id));
    } catch (err) {
      this.error.set('Failed to delete template');
      console.error('Error deleting template:', err);
    }
  }

  isTemplateApplying(templateId: string): boolean {
    return this.isApplying() && this.applyingTemplateId() === templateId;
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }
}
