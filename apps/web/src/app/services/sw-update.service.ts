import { Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class SwUpdateService {
    private readonly swUpdate = inject(SwUpdate);

    constructor() {
        if (!this.swUpdate.isEnabled) {
            return;
        }

        this.swUpdate.versionUpdates
            .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
            .subscribe(() => {
                this.showUpdateNotification();
            });
    }

    private showUpdateNotification(): void {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'sw-update-toast';
        toast.innerHTML = `
            <span>A new version is available</span>
            <button class="sw-update-btn">Update</button>
        `;

        // Add styles
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--color-surface, #fff);
            color: var(--color-text-main, #1f2937);
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 10000;
            font-size: 14px;
            border: 1px solid var(--color-border, #e5e7eb);
        `;

        const button = toast.querySelector('.sw-update-btn') as HTMLButtonElement;
        button.style.cssText = `
            background: var(--color-primary, #D94E3B);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
        `;

        button.addEventListener('click', () => {
            document.location.reload();
        });

        document.body.appendChild(toast);

        // Auto-dismiss after 2 minutes
        setTimeout(() => {
            toast.remove();
        }, 120000);
    }
}
