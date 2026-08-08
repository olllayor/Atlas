/**
 * Declared connectors, shown and never offered.
 *
 * A connector is not a remote MCP server, and the browser says so in its own
 * words rather than filing them under the same heading. An MCP server is an
 * endpoint Atlas reaches with a token the user configured; a connector names an
 * OAuth integration whose token is supplied by the *application* that
 * authorised it. Atlas has no connector broker, so every row here is
 * informational.
 *
 * Shown anyway because silence would be a worse answer. 85% of the official
 * catalogue ships an `.app.json`, and describing those bundles as offering
 * nothing is false — they offer something Atlas cannot yet perform, which is a
 * different sentence and the one a user needs before installing.
 */

import { LockClosedIcon } from '@radix-ui/react-icons';

import type { PluginConnectorSummary } from '../../../shared/contracts';
import { CONNECTOR_UNAVAILABLE_NOTICE } from '../../../shared/pluginConnectors';

const KIND_LABEL: Record<PluginConnectorSummary['kind'], string> = {
  'first-party-connector': 'OAuth connector',
  'apps-sdk-app': 'Apps SDK app',
  unknown: 'connector'
};

export function ConnectorList({ connectors }: { connectors: PluginConnectorSummary[] }) {
  if (connectors.length === 0) {
    return null;
  }

  return (
    <section className="space-y-1.5">
      <h4 className="text-2xs uppercase tracking-wide text-text-faint">
        Connectors ({connectors.length})
      </h4>

      {connectors.map((connector) => (
        <div
          key={connector.key}
          className="rounded-md border border-border-default bg-bg-surface p-2"
        >
          <div className="flex items-baseline gap-2">
            <LockClosedIcon className="size-3 shrink-0 translate-y-0.5 text-text-faint" aria-hidden />
            <span className="text-xs text-text-secondary">{connector.key}</span>
            <span className="text-3xs text-text-faint">{KIND_LABEL[connector.kind]}</span>
            {connector.required ? (
              <span className="text-3xs text-warning-text">required by this plugin</span>
            ) : null}
          </div>

          {/* The opaque id, so a user can match it against something they may
              already have authorised elsewhere. Never resolved by Atlas. */}
          <p className="app-code-compact mt-0.5 break-all pl-5 text-3xs text-text-faint">
            {connector.id}
          </p>

          {connector.capabilities.length > 0 ? (
            <p className="mt-0.5 pl-5 text-3xs text-text-faint">
              Declares: {connector.capabilities.join(', ')}
            </p>
          ) : null}

          <p className="mt-1 pl-5 text-2xs text-warning-text">{CONNECTOR_UNAVAILABLE_NOTICE}</p>
        </div>
      ))}
    </section>
  );
}
