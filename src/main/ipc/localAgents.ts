import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import { isLocalAgentId, type LocalAgentUpdateRequest } from '../../shared/localAgents';
import type { LocalAgentController } from '../ai/agents/localAgentController';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

type LocalAgentsIpcDeps = {
  /** Absent when the integration was not wired (tests, headless). */
  localAgents?: LocalAgentController;
};

export function registerLocalAgentsIpc({ localAgents }: LocalAgentsIpcDeps) {
  function requireController(): LocalAgentController {
    if (!localAgents) {
      throw new Error('Local agents are not available in this build.');
    }
    return localAgents;
  }

  ipcMain.handle(
    IPC_CHANNELS.localAgentsList,
    withUserFacingErrors(IPC_CHANNELS.localAgentsList, async (event) => {
      assertTrustedSender(event);
      return requireController().list();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.localAgentsUpdate,
    withUserFacingErrors(
      IPC_CHANNELS.localAgentsUpdate,
      async (event, request: LocalAgentUpdateRequest) => {
        assertTrustedSender(event);
        // The agent id decides which settings blob is written and which child
        // gets spawned, so it is validated here rather than trusted.
        if (!request || !isLocalAgentId(request.agentId)) {
          throw new Error('Unknown local agent.');
        }
        return requireController().update(request);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.localAgentsProbe,
    withUserFacingErrors(IPC_CHANNELS.localAgentsProbe, async (event, agentId: unknown) => {
      assertTrustedSender(event);
      if (!isLocalAgentId(agentId)) {
        throw new Error('Unknown local agent.');
      }
      return requireController().probe(agentId);
    })
  );
}
