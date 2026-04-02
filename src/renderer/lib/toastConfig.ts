export type AtlasToastTone = 'success' | 'error' | 'info';

export type NotifyOptions = {
  tone: AtlasToastTone;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function getToastDuration(tone: AtlasToastTone) {
  return tone === 'error' ? 4500 : 2500;
}

export function hasToastAction(options: Pick<NotifyOptions, 'actionLabel' | 'onAction'>) {
  return Boolean(options.actionLabel?.trim() && options.onAction);
}
