# CDK Overlays & Dialogs Style Guide

This guide covers how to use `@angular/cdk` for dialogs, overlays, popovers, and dropdowns in Just Maple.

---

## Overview

We use CDK (not Angular Material) for all overlay-based UI. CDK provides the positioning, backdrop, focus trapping, and z-index management without any opinionated styling.

| CDK Module               | Use Case                                           |
| ------------------------ | -------------------------------------------------- |
| `@angular/cdk/dialog`    | Modals, confirm/prompt dialogs, full-screen panels |
| `@angular/cdk/overlay`   | Popovers, dropdowns, command menus, tooltips       |
| `@angular/cdk/drag-drop` | Kanban boards, sidebar reordering                  |
| `@angular/cdk/scrolling` | Virtual scroll lists                               |
| `@angular/cdk/layout`    | Breakpoint detection                               |
| `@angular/cdk/clipboard` | Copy to clipboard                                  |

---

## Dialogs (`@angular/cdk/dialog`)

Use CDK Dialog for any centered modal that overlays the entire page.

### Pattern: Service-based dialog

Dialogs are opened from services, not from templates. This avoids importing dialog components into every parent.

```typescript
// In a service (e.g., dialog.service.ts or ui-state.service.ts)
import { Dialog, type DialogRef } from '@angular/cdk/dialog';

@Injectable({ providedIn: 'root' })
export class MyService {
    private readonly cdkDialog = inject(Dialog);

    async openMyDialog(data: MyData): Promise<MyResult | undefined> {
        // Lazy import to avoid circular dependencies
        const { MyDialogComponent } = await import('./my-dialog.component');

        const dialogRef = this.cdkDialog.open(MyDialogComponent, {
            data,
            hasBackdrop: true,
            backdropClass: 'cdk-dialog-backdrop',
            panelClass: 'cdk-dialog-panel',
            autoFocus: false,
        });

        return firstValueFrom(dialogRef.closed) as Promise<MyResult | undefined>;
    }
}
```

### Pattern: Dialog component

Dialog components inject `DIALOG_DATA` for input and `DialogRef` to close with a result.

```typescript
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';

@Component({ ... })
export class MyDialogComponent {
  readonly data = inject<MyData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<MyResult | undefined>>(DialogRef);

  onConfirm(): void {
    this.dialogRef.close({ success: true });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }
}
```

CDK handles Escape key and backdrop click automatically -- do **not** add manual `@HostListener('document:keydown')` for Escape or manual backdrop divs.

### Dialog template

Dialog templates should contain **only the panel content** (no backdrop, no fixed positioning, no z-index). CDK manages all of that.

```html
<!-- DO: just the content -->
<div class="bg-[var(--color-surface)] rounded-lg shadow-xl p-6 max-w-md">
    <h2>Title</h2>
    <p>Content</p>
    <button (click)="onConfirm()">OK</button>
</div>

<!-- DON'T: manual backdrop/positioning -->
<div class="fixed inset-0 z-50 bg-black/50">
    <div class="centered-panel">...</div>
</div>
```

### Existing dialogs

| Dialog               | Service          | Panel Class                  | Purpose                        |
| -------------------- | ---------------- | ---------------------------- | ------------------------------ |
| Confirm/Prompt/Alert | `DialogService`  | `cdk-dialog-panel`           | Generic confirm, prompt, alert |
| Search Modal         | `UiStateService` | `cdk-search-modal-panel`     | Global search (Cmd+K)          |
| Template Gallery     | `UiStateService` | `cdk-template-gallery-panel` | New page from template         |

---

## Overlays (`@angular/cdk/overlay`)

Use CDK Overlay for UI that appears relative to a trigger element (dropdowns, popovers, command menus).

### Two approaches

| Approach                                   | When to use                                                               | Example                                 |
| ------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| **Template-based** (`CdkConnectedOverlay`) | Simple dropdowns with a trigger element in the template                   | Sidebar "New" dropdown, New Page Button |
| **Programmatic** (`Overlay` service)       | Dynamic positioning (e.g., editor cursor), no trigger element in template | AI Command Menu                         |

### Pattern: Template-based overlay

Use `CdkOverlayOrigin` on the trigger and `CdkConnectedOverlay` on an `<ng-template>` for the content.

```typescript
import {
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    type ConnectedPosition,
} from '@angular/cdk/overlay';

@Component({
    imports: [CdkOverlayOrigin, CdkConnectedOverlay],
})
export class MyDropdownComponent {
    readonly isOpen = signal(false);

    readonly positions: ConnectedPosition[] = [
        // Below, aligned to end
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        // Above, aligned to end (fallback if no space below)
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    ];
}
```

```html
<button cdkOverlayOrigin #trigger="cdkOverlayOrigin" (click)="isOpen.update(v => !v)">Open</button>

<ng-template
    cdkConnectedOverlay
    [cdkConnectedOverlayOrigin]="trigger"
    [cdkConnectedOverlayOpen]="isOpen()"
    [cdkConnectedOverlayHasBackdrop]="true"
    cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
    [cdkConnectedOverlayPositions]="positions"
    (backdropClick)="isOpen.set(false)"
>
    <div
        class="bg-[var(--color-surface)] rounded-lg shadow-lg border border-[var(--color-border)] py-1"
    >
        <!-- dropdown content -->
    </div>
</ng-template>
```

**Important:** The `cdkOverlayOrigin` directive must be on an element that is **always rendered**. Do not place it inside an `@if` block if the `cdkConnectedOverlay` references it outside that block -- template reference variables are scoped to their control flow block.

### Pattern: Programmatic overlay

Use the `Overlay` service when positioning relative to dynamic coordinates (e.g., editor cursor position).

```typescript
import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

private readonly overlay = inject(Overlay);

openMenu(x: number, y: number): void {
  const positionStrategy = this.overlay
    .position()
    .flexibleConnectedTo({ x, y })
    .withPositions([
      // Below the point
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
      // Above the point (fallback)
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
    ]);

  const overlayRef = this.overlay.create({
    positionStrategy,
    hasBackdrop: true,
    backdropClass: 'cdk-overlay-transparent-backdrop',
  });

  const portal = new ComponentPortal(MyMenuComponent, null, this.injector);
  const componentRef = overlayRef.attach(portal);
  componentRef.setInput('someInput', value);

  // Clean up
  overlayRef.backdropClick().subscribe(() => overlayRef.dispose());
  componentRef.instance.closed.subscribe(() => overlayRef.dispose());
}
```

---

## Backdrop Classes

Two backdrop classes are defined in `styles.scss`:

| Class                              | Visual                                                  | Use for                            |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `cdk-dialog-backdrop`              | Semi-transparent black (`rgba(0,0,0,0.5)`) with fade-in | Modals, dialogs                    |
| `cdk-overlay-transparent-backdrop` | Fully transparent                                       | Dropdowns, popovers, command menus |

Both backdrops capture clicks. The difference is purely visual.

---

## Global Styles (`styles.scss`)

All CDK overlay styles are defined globally in `styles.scss` under the `/* CDK Dialog & Overlay */` section. Component SCSS should **not** include:

- `position: fixed` for overlays (CDK handles it)
- `z-index` for overlays (CDK manages stacking)
- Backdrop divs (CDK provides them)
- Manual viewport-flip logic (CDK `FlexibleConnectedPositionStrategy` handles it)

### Panel classes

Custom `panelClass` values control how the CDK overlay pane is styled (layout, padding, alignment). Define new ones in `styles.scss` when a dialog needs non-default positioning:

```scss
// Centered (default for dialogs)
.cdk-dialog-panel {
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: auto;
}

// Near top of viewport (for search)
.cdk-search-modal-panel {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
    pointer-events: auto;
}
```

**Naming convention:** `cdk-{feature}-panel` (e.g., `cdk-search-modal-panel`, `cdk-template-gallery-panel`).

---

## Common Position Configurations

```typescript
// Dropdown below, aligned right (e.g., "New" button)
const dropdownRight: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
];

// Dropdown below, aligned left (e.g., sidebar dropdown)
const dropdownLeft: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

// Popover below a point (e.g., editor cursor)
const popoverAtCursor: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
];
```

---

## Do / Don't

| Do                                                        | Don't                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Open dialogs from services with lazy imports              | Import dialog components in parent `imports` array                |
| Use `DIALOG_DATA` + `DialogRef` in dialog components      | Use `input()` / `output()` for dialog data flow                   |
| Use `CdkConnectedOverlay` for template dropdowns          | Use `position: absolute` + `@HostListener('document:click')`      |
| Use `Overlay` service for dynamic cursor-positioned menus | Use `document.createElement` + `document.body.appendChild`        |
| Use `cdk-dialog-backdrop` for modals                      | Create manual `<div class="fixed inset-0 bg-black/50">` backdrops |
| Use `cdk-overlay-transparent-backdrop` for dropdowns      | Use `<div class="fixed inset-0 z-40">` click catchers             |
| Let CDK handle Escape key for dialogs                     | Add `@HostListener('document:keydown')` for Escape in dialogs     |
| Define panel classes in `styles.scss`                     | Add `z-index` or `position: fixed` in component SCSS              |
| Place `cdkOverlayOrigin` on always-rendered elements      | Place `cdkOverlayOrigin` inside `@if` blocks                      |

---

## Keyboard Handling

- **Dialogs:** CDK auto-closes on Escape. Do not add manual Escape handling.
- **Overlays with context-dependent Escape** (e.g., AI Command Menu with sub-views): Disable CDK's auto-close and handle Escape in the component. The component emits a `closed` output when it should dismiss.
- **Arrow key navigation** within overlay content: Handle in the component via `@HostListener` or `(keydown)` binding. CDK does not manage this.
