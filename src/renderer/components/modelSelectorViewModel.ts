import type { CustomProvider, ModelSummary, ProviderCredentialSummary } from '../../shared/contracts.js';
import { isLocalAgentId } from '../../shared/localAgents.js';
import { OPENCODE_PROVIDER_ID } from '../../shared/opencodeSettings.js';
import { resolveProviderLabel } from '../../shared/providerMetadata.js';

/**
 * Local agents (OpenCode, Antigravity, Claude Code, Codex, Cursor, Grok) sign
 * in on their own (or hold credentials in their own profiles / keychain), so Atlas
 * never holds a standard BYOK key for them. Without this their models would sort
 * below the configured ones and offer an API-key prompt that fixes nothing.
 */
function providerAuthenticatesItself(providerId: string) {
  return providerId === OPENCODE_PROVIDER_ID || isLocalAgentId(providerId);
}

/**
 * True for a provider that is an integration rather than an endpoint: it holds
 * its own credentials and runs the turn itself. Exported so the chip can mark
 * a selected model the same way the menu marks its group.
 */
export function isSelfManagedProvider(providerId: string): boolean {
  return providerAuthenticatesItself(providerId);
}

export type ProviderRef = Pick<CustomProvider, 'id' | 'name'>;

export type ModelGroup = {
  /** Identity of the group. Two providers may share a display name. */
  providerId: string;
  /** Provider display name, used as the group heading. */
  label: string;
  models: ModelSummary[];
  /** False when no API key is saved for the provider backing this group. */
  configured: boolean;
  /**
   * The provider is an integration that runs the turn itself, not an endpoint
   * Atlas calls. Worth marking: the same OpenCode can also be reached as an
   * ordinary base-URL provider, and the two behave nothing alike. This one
   * brings its own tools, approvals and sampling.
   */
  selfManaged: boolean;
};

export type ProviderStripItem = {
  providerId: string;
  label: string;
  modelCount: number;
  configured: boolean;
  selfManaged: boolean;
};

export type ModelRow = {
  model: ModelSummary;
  providerId: string;
  providerLabel: string;
  /** Short display name for the one-line row. */
  name: string;
  configured: boolean;
  selfManaged: boolean;
  /** True when another visible row shares this short name. */
  ambiguous: boolean;
};

export type ModelSelectorViewModel = {
  /** Full provider list for the strip. Same order as today (configured first, then label). */
  strip: ProviderStripItem[];
  /** Models after providerFilter and searchQuery, one line each. */
  rows: ModelRow[];
  totalCount: number;
  hasFreeModels: boolean;
};

const extractModelName = (modelId: string): string => {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : modelId;
};

/**
 * The chip and the dense row name the model the way a person would, not the
 * way the gateway does. The catalog's `label` is the human name; a raw id
 * segment is what filled the chip before. The gateway suffix only ever marked
 * pricing, which the menu's Free badge already says.
 */
export function modelShortName(model: Pick<ModelSummary, 'id' | 'label'>): string {
  if (model.label && model.label !== model.id) {
    return model.label;
  }
  return extractModelName(model.id).replace(/[:@](free|beta|preview|latest)$/i, '');
}

export function buildModelSelectorViewModel({
  models,
  customProviders = [],
  credentials,
  showFreeOnly,
  providerFilter,
  searchQuery
}: {
  models: ModelSummary[];
  customProviders?: ProviderRef[];
  credentials?: ProviderCredentialSummary[];
  showFreeOnly: boolean;
  providerFilter?: string | null;
  searchQuery?: string;
}): ModelSelectorViewModel {
  const hasFreeModels = models.some((model) => model.isFree);

  // A catalog made only of user-configured endpoints has nothing free in it, so
  // applying the filter would empty the list with no way to recover.
  const freeFilterActive = showFreeOnly && hasFreeModels;

  // Without any credential data, assume everything is usable rather than
  // flagging the whole catalog as unconfigured.
  const knowsCredentials = (credentials?.length ?? 0) > 0;
  const configuredProviderIds = new Set(
    (credentials ?? []).filter((entry) => entry.hasSecret).map((entry) => entry.providerId)
  );
  const isConfigured = (model: ModelSummary) =>
    !knowsCredentials ||
    providerAuthenticatesItself(model.providerId) ||
    configuredProviderIds.has(model.providerId);

  const filtered = models.filter((model) => !freeFilterActive || model.isFree);

  // Grouped by provider id, not by display name: a user-configured endpoint
  // may well be called "OpenCode" too, and merging it with the integration
  // would put models that behave differently under one heading.
  const byProvider = new Map<string, ModelSummary[]>();
  for (const model of filtered) {
    const bucket = byProvider.get(model.providerId);
    if (bucket) {
      bucket.push(model);
    } else {
      byProvider.set(model.providerId, [model]);
    }
  }

  const groups = [...byProvider.entries()]
    .map<ModelGroup>(([providerId, groupModels]) => ({
      providerId,
      label: resolveProviderLabel(providerId, customProviders),
      models: groupModels,
      configured: groupModels.some(isConfigured),
      selfManaged: providerAuthenticatesItself(providerId)
    }))
    // Providers you can actually send to come first.
    .sort((a, b) => {
      if (a.configured !== b.configured) {
        return a.configured ? -1 : 1;
      }

      return a.label.localeCompare(b.label);
    });

  // The strip always shows the full free-filtered catalog so the user can hop
  // providers even while a filter is active on the list below.
  const strip = groups.map<ProviderStripItem>((group) => ({
    providerId: group.providerId,
    label: group.label,
    modelCount: group.models.length,
    configured: group.configured,
    selfManaged: group.selfManaged
  }));

  const scopedGroups = providerFilter
    ? groups.filter((group) => group.providerId === providerFilter)
    : groups;

  const query = (searchQuery ?? '').trim().toLowerCase();
  const baseRows = scopedGroups.flatMap<ModelRow>((group) =>
    group.models.map((model) => ({
      model,
      providerId: group.providerId,
      providerLabel: group.label,
      name: modelShortName(model),
      configured: group.configured,
      selfManaged: group.selfManaged,
      ambiguous: false
    }))
  );

  const visibleRows = query
    ? baseRows.filter(
        (row) => row.name.toLowerCase().includes(query) || row.model.id.toLowerCase().includes(query)
      )
    : baseRows;

  const nameCounts = new Map<string, number>();
  for (const row of visibleRows) {
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }

  return {
    strip,
    rows: visibleRows.map((row) => ({
      ...row,
      ambiguous: (nameCounts.get(row.name) ?? 0) > 1
    })),
    totalCount: groups.reduce((sum, group) => sum + group.models.length, 0),
    hasFreeModels
  };
}

/** True when the model's provider has no key saved and we know that for sure. */
export function modelNeedsApiKey(model: ModelSummary, credentials?: ProviderCredentialSummary[]) {
  if ((credentials?.length ?? 0) === 0 || providerAuthenticatesItself(model.providerId)) {
    return false;
  }

  return !credentials!.some((entry) => entry.providerId === model.providerId && entry.hasSecret);
}
