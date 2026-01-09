import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { TagService } from '../../services/tag.service';

@Component({
  selector: 'app-tag',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './tag.component.html',
  styleUrl: './tag.component.scss',
})
export class TagComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tagService = inject(TagService);
  private routeSubscription?: Subscription;

  ngOnInit(): void {
    // Subscribe to route params and set active tag
    this.routeSubscription = this.route.params.subscribe((params) => {
      const tagId = params['tagId'];
      if (tagId) {
        this.tagService.setActiveTag(tagId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }
}
