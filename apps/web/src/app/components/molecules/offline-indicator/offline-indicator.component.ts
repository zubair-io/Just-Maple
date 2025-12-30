import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NetworkService } from '../../../services/network.service';

@Component({
  selector: 'app-offline-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOffline()) {
      <div
        class="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm"
      >
        <span class="material-symbols-rounded text-base">wifi_off</span>
        <span>Working offline</span>
        @if (offlineDuration(); as duration) {
          <span class="opacity-75">· Last online {{ duration }}</span>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class OfflineIndicatorComponent {
  private readonly network = inject(NetworkService);

  readonly isOffline = this.network.isOffline;
  readonly lastOnlineAt = this.network.lastOnlineAt;

  readonly offlineDuration = computed(() => {
    if (this.network.isOnline()) return null;
    const now = new Date();
    const last = this.lastOnlineAt();
    const ms = now.getTime() - last.getTime();
    return this.formatDuration(ms);
  });

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
}
