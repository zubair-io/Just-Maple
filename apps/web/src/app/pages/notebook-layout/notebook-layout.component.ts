import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-notebook-layout',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        height: 100%;
        width: 100%;
        min-height: 0;
        overflow: hidden;
      }
    `,
  ],
})
export class NotebookLayoutComponent {}
