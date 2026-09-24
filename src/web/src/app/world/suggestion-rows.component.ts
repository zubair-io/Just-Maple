import { Component, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { MuiButtonComponent } from '@maple/ui';
import { WorldService } from './world.service';
import { Suggestion } from './world.models';
@Component({
  selector: 'maple-suggestion-rows', standalone: true,
  imports: [MuiButtonComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (s of suggestions(); track s.id) {
    <article class="attention-row" [attr.data-suggestion-id]="s.id">
      <small>Suggested · needs your review</small>
      <h3>{{ s.candidate.title }}</h3>
      @if (s.sourceSubject) { <p><strong>{{ s.sourceSubject }}</strong><br>{{ s.sourceSender }}</p> }
      <p>{{ s.candidate.description }}</p>
      <blockquote>{{ s.quote }}</blockquote>
      <div class="tag-row">
        @for (id of s.candidate.activityIDs; track id) {
          <button class="activity-tag" (click)="world.go('activities/' + id)">{{ world.activity(id)?.name || 'Unavailable activity' }}</button>
        } @empty { <small>No activity assigned</small> }
      </div>
      <p>{{ s.deadlineExplanation }}</p>
      <mui-button (pressed)="world.go('suggestions/' + s.id)">Review action &amp; source</mui-button>
    </article>
  } @empty { <p>No suggested tasks match this view.</p> }`
})
export class SuggestionRowsComponent {
  readonly world = inject(WorldService);
  readonly suggestions = input.required<Suggestion[]>();
}
