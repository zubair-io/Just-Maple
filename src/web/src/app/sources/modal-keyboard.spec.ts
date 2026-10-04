import { expect, it } from 'vitest';
import { retainModalTab } from './modal-keyboard';
it('wraps Tab boundaries while leaving interior keys and composition to native controls', () => {
  const dialog = document.createElement('div');
  dialog.innerHTML = '<button>Close</button><input aria-label="Search"><button disabled>Unavailable</button><button>Last</button>';
  document.body.append(dialog);
  const checker = { isFocusable: (el: HTMLElement) => !el.hasAttribute('disabled'), isTabbable: () => true };
  const buttons = dialog.querySelectorAll('button'), first = buttons[0], last = buttons[2];
  const tab = () => new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
  last.focus(); const forward = tab(); retainModalTab(dialog, forward, checker);
  expect(forward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
  const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }); retainModalTab(dialog, backward, checker);
  expect(backward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
  dialog.querySelector('input')!.focus(); const middle = tab(); retainModalTab(dialog, middle, checker); expect(middle.defaultPrevented).toBe(false);
  last.focus(); const composing = new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, cancelable: true }); retainModalTab(dialog, composing, checker); expect(composing.defaultPrevented).toBe(false);
  dialog.remove();
});
