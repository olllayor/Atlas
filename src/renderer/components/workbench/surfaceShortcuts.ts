/**
 * The picker's single-letter shortcuts.
 *
 * They fire while the picker is on screen rather than while it is focused:
 * focus moves on any stray click, and a launcher whose keys stop working
 * because the user clicked the panel background is a launcher nobody trusts.
 * That reach is exactly why the guards below are strict — a bare letter is the
 * cheapest key on the keyboard to steal by accident.
 */

export type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'defaultPrevented' | 'isComposing' | 'key' | 'metaKey'
>;

/**
 * Overlays that own the keyboard while they are up. An open menu or dialog is
 * a modal conversation; a letter typed into it belongs to its own type-ahead,
 * not to the panel underneath.
 */
export const SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="context-menu-content"]',
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="hover-card-content"]',
].join(',');

/**
 * The matching action, or null when this keystroke is not ours: any modifier
 * means the user is aiming at an app shortcut, an IME composition is mid-word,
 * and an already-defaulted event was claimed by something closer to the user.
 */
export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase()
    ) ?? null
  );
}

/**
 * Whether the keystroke was aimed at somewhere text goes.
 *
 * A focused composer is a typing context whether or not it has text in it yet:
 * it is where the user's next keystrokes are meant to land, and claiming
 * letters from it would redirect a prompt into whatever surface opened. The
 * `:not` clause lets `closest` see past non-editable islands inside an
 * editable host.
 */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null
): boolean {
  return (
    target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    ) != null
  );
}
