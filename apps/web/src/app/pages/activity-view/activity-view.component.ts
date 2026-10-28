import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PageService } from '../../services/page.service';
import { ActionLogComponent } from '../../components/organisms/action-log/action-log.component';

/**
 * A notebook's Activity page (one per notebook, from "+ New"): what bots did and offered
 * to do here, newest first. You see your own actions in full; other members' only when
 * they were posted in this notebook's chats, and only their summaries.
 */
@Component({
  selector: 'app-activity-view',
  standalone: true,
  imports: [ActionLogComponent],
  templateUrl: './activity-view.component.html',
  styleUrl: './activity-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly pageService = inject(PageService);

  private readonly pageId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly page = computed(
    () => this.pageService.pages().find((page) => page.id === this.pageId()) ?? null,
  );
  readonly notebookId = computed(() => this.page()?.notebookId ?? null);
}
