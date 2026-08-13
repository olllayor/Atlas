/**
 * `Using @github` — which plugin a turn was scoped to, and whether it worked.
 *
 * Rendered from the resolved `plugin-invocation` part, never by re-parsing the
 * message text. That distinction is the whole point: the main process already
 * decided what `@github pr-review` meant against the installed set, and a
 * second parse in the renderer would be a second answer that drifts the moment
 * a plugin is disabled, renamed, or updated mid-conversation.
 *
 * Shown for failures as well as successes. A mention that produced nothing is
 * precisely the case a user needs told about — silence is indistinguishable
 * from a typo, and they retype a name that was right all along.
 */

import { CubeIcon } from '@radix-ui/react-icons';

import type { ChatPluginInvocationPart } from '../../../shared/contracts';
import { cn } from '../../lib/utils';

export function PluginInvocationRow({ part }: { part: ChatPluginInvocationPart }) {
  const failed = part.outcome !== 'invoked';

  return (
    <div
      role="listitem"
      className={cn(
        'flex items-baseline gap-1.5 py-0.5 text-sm leading-relaxed',
        failed ? 'text-warning-text' : 'text-text-tertiary'
      )}
    >
      <CubeIcon className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
      <span className="min-w-0">
        {/* The mention verbatim, as the user typed it. Reconstructing it from
            the resolved plugin and skill would quietly correct their casing and
            spacing, which makes the row a worse record of what happened. */}
        <span className={failed ? undefined : 'text-text-secondary'}>
          {failed ? 'Could not use' : 'Using'} {part.mention}
        </span>
        {part.version && !failed ? (
          <span className="ml-1.5 text-2xs text-text-faint">v{part.version}</span>
        ) : null}
        {part.detail ? <span className="ml-1.5 text-2xs">{part.detail}</span> : null}
      </span>
    </div>
  );
}
