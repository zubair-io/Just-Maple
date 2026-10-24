import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ImageFit = 'cover' | 'contain';

@Component({
  selector: 'app-image',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './image.component.scss',
})
export class ImageComponent {
  readonly src = input<string>('');
  readonly alt = input<string>('');
  readonly fit = input<ImageFit>('cover');
  readonly rounded = input<boolean>(false);

  get imgClasses(): string {
    const fitClass = this.fit() === 'contain' ? 'object-contain' : 'object-cover';
    const roundedClass = this.rounded() ? 'rounded-lg' : '';
    return `w-full h-auto ${fitClass} ${roundedClass}`;
  }
}
