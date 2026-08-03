import { useCallback, useEffect, useState } from 'react';

import type { ProjectContextInfo } from '../../shared/contracts';
import { DEFAULT_WORKSPACE_MODE } from '../../shared/workspaceModes';

const EMPTY: ProjectContextInfo = {
  project: null,
  projectType: { type: 'unknown' },
  envKeys: [],
  detectedEnvKeys: [],
  mode: DEFAULT_WORKSPACE_MODE,
  agentInstructions: null,
};

/**
 * What the main process detected about the conversation's project: type,
 * framework, and which env vars are configured for it.
 *
 * Detection touches the filesystem, so it is fetched rather than derived, and
 * re-fetched when the conversation's project changes (`projectId` is part of
 * the dependency list, not just the conversation id — re-attaching a folder
 * keeps the same conversation).
 */
export function useWorkspaceContext(conversationId: string | null | undefined, projectId: string | null) {
  const [context, setContext] = useState<ProjectContextInfo>(EMPTY);

  const refresh = useCallback(async () => {
    if (!conversationId || !window.atlasChat?.workspace?.getContext) {
      setContext(EMPTY);
      return;
    }

    try {
      setContext(await window.atlasChat.workspace.getContext(conversationId));
    } catch (err) {
      console.warn('Failed to load workspace context:', err);
      setContext(EMPTY);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    // `projectId` is intentionally a dependency: attaching or detaching a
    // folder changes the answer without changing the conversation.
  }, [refresh, projectId]);

  return { context, refresh };
}
