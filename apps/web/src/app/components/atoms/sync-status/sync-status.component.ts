import { Component, inject, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectivityService } from '../../../services/connectivity.service';
import { MemoDocumentService } from '../../../services/memo-document.service';
import { OfflineQueueService } from '../../../services/offline-queue.service';

@Component({
  selector: 'app-sync-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sync-status.component.html',
  styleUrl: './sync-status.component.scss',
})
export class SyncStatusComponent {
  private readonly connectivity = inject(ConnectivityService);
  private readonly memoService = inject(MemoDocumentService);
  private readonly offlineQueue = inject(OfflineQueueService);

  readonly pageId = input.required<string>();

  readonly status = computed(() => {
    // Check offline first
    if (!this.connectivity.isOnline()) {
      return 'offline';
    }

    // Check if there are pending operations for this page
    if (this.offlineQueue.hasPendingForNote(this.pageId())) {
      return 'pending';
    }

    // Get sync status from memo service
    return this.memoService.getSyncStatus(this.pageId());
  });

  readonly statusText = computed(() => {
    switch (this.status()) {
      case 'synced':
        return 'Saved';
      case 'syncing':
        return 'Saving...';
      case 'pending':
        return 'Pending sync';
      case 'offline':
        return 'Offline';
      case 'failed':
        return 'Sync failed';
      case 'conflict':
        return 'Conflict';
      default:
        return '';
    }
  });

  readonly statusIcon = computed(() => {
    switch (this.status()) {
      case 'synced':
        return '✓';
      case 'syncing':
        return '↻';
      case 'pending':
        return '○';
      case 'offline':
        return '⊘';
      case 'failed':
        return '✗';
      case 'conflict':
        return '⚠';
      default:
        return '';
    }
  });

  readonly peersCount = computed(() => {
    return this.memoService.getPeersCount(this.pageId());
  });
}
