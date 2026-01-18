import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';

@Component({
  selector: 'app-tag',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './tag.component.html',
  styleUrl: './tag.component.scss',
})
export class TagComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly notebookService = inject(NotebookService);
  private routeSubscription?: Subscription;

  ngOnInit(): void {
    // Subscribe to route params and set active notebook
    this.routeSubscription = this.route.params.subscribe((params) => {
      const notebookId = params['tagId'];
      if (notebookId) {
        this.notebookService.setActiveNotebook(notebookId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }
}
