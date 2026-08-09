/**
 * Display labels for modifier keys, adapted to the operator's OS. The keyboard handlers accept both
 * ⌘ (metaKey) and Ctrl (ctrlKey) everywhere, so only the *labels* in tooltips and the shortcut sheet
 * need to switch — a Windows/Linux user sees "Ctrl", a mac user sees "⌘".
 */
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || '');

/** Primary command modifier: "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
/** Shift key: the "⇧" glyph on macOS, the word "Shift" elsewhere. */
export const SHIFT_KEY = isMac ? '⇧' : 'Shift';
/** Return/Enter key: "↵" on macOS, "Enter" elsewhere. */
export const ENTER_KEY = isMac ? '↵' : 'Enter';

/**
 * Join keys into a single combo label: mac stacks the glyphs ("⌘⇧Z"), Windows/Linux joins the words
 * with "+" ("Ctrl+Shift+Z") so they stay readable.
 */
export function combo(...keys: string[]): string {
  return keys.join(isMac ? '' : '+');
}
