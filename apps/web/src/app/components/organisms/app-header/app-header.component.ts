import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="app-header" [class.home-header]="home()">
      <div class="toolbar">
        <div class="brand">
          <button
            type="button"
            (click)="uiState.toggleSidebar()"
            [attr.aria-label]="uiState.sidebarOpen() ? 'Close navigation' : 'Open navigation'"
            [attr.aria-expanded]="uiState.sidebarOpen()"
            title="Open navigation"
            class="menu-button"
          >
            <span class="material-symbols-rounded" aria-hidden="true">menu</span>
          </button>
          <a routerLink="/" aria-label="Just Maple home" class="brand-link">
            <img src="https://hornbeam.justmaple.app/data/assets/justmaple.svg" alt="" />
            <span>Just Maple</span>
          </a>
        </div>
        <div class="context"><ng-content select="[headerContext]" /></div>
        <div class="actions"><ng-content select="[headerActions]" /></div>
      </div>
      <ng-content select="[headerNavigation]" />
    </header>
  `,
  styleUrl: './app-header.component.scss',
})
export class AppHeaderComponent {
  readonly home = input(false);
  readonly uiState = inject(UiStateService);
}
