import { toast } from 'sonner';

import type { NotifyOptions } from './toastConfig';
import { getToastDuration, hasToastAction } from './toastConfig';

function buildToastAction(options: NotifyOptions) {
  if (!hasToastAction(options) || !options.onAction) {
    return undefined;
  }

  return {
    label: options.actionLabel!,
    onClick: () => options.onAction?.(),
  };
}

export function notify(options: NotifyOptions) {
  const sharedOptions = {
    description: options.description,
    duration: getToastDuration(options.tone),
    closeButton: false,
    dismissible: false,
    action: buildToastAction(options),
  };

  switch (options.tone) {
    case 'success':
      return toast.success(options.title, sharedOptions);
    case 'error':
      return toast.error(options.title, sharedOptions);
    default:
      return toast.info(options.title, sharedOptions);
  }
}
