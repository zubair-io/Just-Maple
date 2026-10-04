import { InteractivityChecker } from '@angular/cdk/a11y';

/** Keep boundary Tab presses in the active native modal instead of browser chrome. */
export function retainModalTab(dialog: HTMLElement, event: KeyboardEvent, checker: Pick<InteractivityChecker, 'isFocusable' | 'isTabbable'>) {
  if (event.key !== 'Tab' || event.isComposing) return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex],audio[controls]'))
    .filter(element => checker.isFocusable(element) && checker.isTabbable(element));
  if (!controls.length) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
  const active = dialog.ownerDocument.activeElement;
  if ((event.shiftKey && active === controls[0]) || (!event.shiftKey && active === controls.at(-1))) {
    event.preventDefault();
    (event.shiftKey ? controls.at(-1)! : controls[0]).focus({ preventScroll: true });
  }
}
