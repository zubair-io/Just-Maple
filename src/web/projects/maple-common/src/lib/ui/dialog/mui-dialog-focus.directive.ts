import { InteractivityChecker } from '@angular/cdk/a11y';
import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject, input, output } from '@angular/core';
import { retainModalTab } from './modal-keyboard';

/** Native modal lifecycle shared by naming, document tools and source pickers. */
@Directive({ selector: 'dialog[muiDialogFocus]', standalone: true })
export class MuiDialogFocusDirective implements AfterViewInit, OnDestroy {
  readonly dialogClosed = output<void>();
  readonly dialogReturnFocus = input<HTMLElement | (() => HTMLElement | undefined) | undefined>();
  private readonly element = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  private readonly checker = inject(InteractivityChecker);
  private opener: HTMLElement | null = null;
  private disposed = false;
  @HostListener('keydown', ['$event']) keydown(event: KeyboardEvent) {
    retainModalTab(this.element.nativeElement, event, this.checker);
  }
  ngAfterViewInit() {
    const dialog = this.element.nativeElement, active = dialog.ownerDocument.activeElement;
    this.opener = active instanceof HTMLElement && active !== dialog.ownerDocument.body && !dialog.contains(active) ? active : null;
    queueMicrotask(() => {
      if (this.disposed || !dialog.isConnected) return;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      const target = dialog.querySelector<HTMLElement>('[autofocus]')
        ?? dialog.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]),textarea:not([disabled])')
        ?? dialog.querySelector<HTMLElement>('button:not([disabled])');
      target?.focus({ preventScroll: true });
    });
  }
  @HostListener('cancel', ['$event']) cancel(event: Event) {
    event.preventDefault(); this.dialogClosed.emit();
  }
  ngOnDestroy() {
    this.disposed = true;
    const dialog = this.element.nativeElement;
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    // Resolve after Angular has replaced a writing surface (for example Markdown mode).
    const fallback = this.dialogReturnFocus(), opener = this.opener;
    queueMicrotask(() => {
      const target = opener?.isConnected && !opener.closest('[hidden]')
        ? opener : typeof fallback === 'function' ? fallback() : fallback;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }
}
