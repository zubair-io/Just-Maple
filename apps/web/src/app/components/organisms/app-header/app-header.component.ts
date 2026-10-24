import { RecorderWorkspaceService } from '../../../services/recorder-workspace.service';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="app-header" [class.home-header]="home()">
      <div class="toolbar">
        <div class="brand">
          <a routerLink="/" aria-label="Just Maple home" class="brand-link">
            <img src="https://hornbeam.justmaple.app/data/assets/justmaple.svg" alt="" />
            @if (home()) {
              <span>Just Maple</span>
            }
          </a>
        </div>
        <div class="context"><ng-content select="[headerContext]" /></div>
        @if (!home()) {
          <div class="navigation"><ng-content select="[headerNavigation]" /></div>
        }
        <div class="actions">
          @if (recorder.state()?.isRecording || recorder.state()?.busy) {
            <a routerLink="/recorder" class="recorder-status" aria-label="Open active recorder">{{
              recorder.state()?.isRecording ? '● Recording' : '◌ Processing'
            }}</a>
          }
          <ng-content select="[headerActions]" />
        </div>
      </div>
    </header>
  `,
  styleUrl: './app-header.component.scss',
})
export class AppHeaderComponent {
  readonly recorder = inject(RecorderWorkspaceService);
  readonly home = input(false);
}
