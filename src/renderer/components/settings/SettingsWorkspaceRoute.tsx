import {
  SettingsWorkspace,
  buildUsageSummary,
  type SettingsWorkspaceProps,
} from '../SettingsWorkspace';

export type SettingsWorkspaceRouteProps = Omit<SettingsWorkspaceProps, 'usageSummary'> & {
  /** Raw inputs for the storage/usage panel; folded here, inside the chunk. */
  usageInputs: Parameters<typeof buildUsageSummary>[0];
};

/**
 * Entry point for the Settings view, so the view can be code-split.
 *
 * `App` used to call `buildUsageSummary` itself, which meant importing the
 * settings module — two thousand lines and everything it pulls — into the
 * initial bundle even for a session that never opens Settings. Folding the
 * summary here keeps that import on the far side of the lazy boundary while the
 * numbers stay exactly the same.
 */
export function SettingsWorkspaceRoute({ usageInputs, ...props }: SettingsWorkspaceRouteProps) {
  return <SettingsWorkspace {...props} usageSummary={buildUsageSummary(usageInputs)} />;
}
