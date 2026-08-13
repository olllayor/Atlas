/**
 * Toast copy rules, so thirty call sites do not each invent their own voice.
 *
 * 1. **Sentence case, no trailing period.** A title is a label, not a
 *    sentence. The app used to be split roughly in half — "Theme imported"
 *    beside "Model catalog refreshed." — and the *same* event even differed
 *    with itself ("Atlas is up to date." in the store, "Atlas is up to date"
 *    in the sidebar menu).
 * 2. **The title says what happened; the description says why or which.**
 *    Never put a raw exception in the title: it is one truncated line with no
 *    room for a 90-character provider error, so the useful half is lost.
 *    `notifyError` exists to make the right shape the easy one.
 * 3. **Do not announce what the user can already see.** A staged model list
 *    that visibly grew, or a theme that visibly changed, does not also need a
 *    toast. Toasts are for outcomes that happen off-screen or on failure.
 * 4. **One owner per event.** If two layers can both report an outcome, one
 *    of them is wrong — pick the layer that knows the most and delete the
 *    other.
 */
export type AtlasToastTone = 'success' | 'error' | 'warning' | 'info';

export type NotifyOptions = {
  tone: AtlasToastTone;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** A toast the user is expected to act on must outlive a glance. */
export const TOAST_DURATION_WITH_ACTION = 6000;

export function getToastDuration(tone: AtlasToastTone, hasAction = false) {
  if (hasAction) {
    return TOAST_DURATION_WITH_ACTION;
  }

  return tone === 'error' || tone === 'warning' ? 4500 : 2500;
}

export function hasToastAction(options: Pick<NotifyOptions, 'actionLabel' | 'onAction'>) {
  return Boolean(options.actionLabel?.trim() && options.onAction);
}
