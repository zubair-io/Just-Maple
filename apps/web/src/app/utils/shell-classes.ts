/**
 * Class lists shared by the notebook list and the notebook screen, so both
 * draw the same rows, round buttons and labels.
 */

/** Small uppercase label above a heading or a group of rows. */
export const KICKER_CLASS =
  'm-0 font-sans text-[11px] font-bold tracking-[0.08em] uppercase text-[var(--color-text-muted)]';

/** Round 38px button: back, close and the quiet header actions. */
export const CIRCLE_BUTTON_CLASS =
  'flex-none flex items-center justify-center w-[38px] h-[38px] p-0 rounded-full bg-[var(--color-row-active)] border border-[var(--color-border)] text-[var(--color-text-main)] no-underline cursor-pointer transition-colors hover:border-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-2';

/** One line in the left list: an icon, a bold name, a quiet note, a dot. */
export const LIST_ROW_CLASS =
  'group flex items-center gap-2.5 w-full h-[50px] md:h-10 mb-1 md:mb-1.5 px-4 box-border rounded-xl border-none font-sans text-base md:text-sm text-left no-underline cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-[-2px]';

export const LIST_ROW_IDLE_CLASS = `${LIST_ROW_CLASS} bg-transparent hover:bg-[var(--color-bg-hover)]`;

export const LIST_ROW_ACTIVE_CLASS = `${LIST_ROW_CLASS} bg-[var(--color-row-active)] shadow-[0_1px_2px_rgba(41,37,36,0.05)]`;

/** A page drawn as a card on the sand background. */
export const CARD_CLASS =
  'flex flex-col overflow-hidden bg-[var(--color-card)] rounded-[18px] shadow-[var(--shadow-card)]';

/** The strip across the top of a card: icon, name, type, close. */
export const CARD_BAND_CLASS =
  'flex-none flex items-center gap-2.5 h-12 pl-6 pr-3 bg-[var(--color-card-band)] font-sans text-sm';

/** Small round button inside a card band. */
export const BAND_BUTTON_CLASS =
  'flex-none flex items-center justify-center w-8 h-8 p-0 rounded-full border-none bg-transparent text-[var(--color-text-muted)] cursor-pointer transition-colors hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg-hover)]';
