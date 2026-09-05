import { create } from 'zustand';

import type {
  LocalAgentId,
  LocalAgentProbeResult,
  LocalAgentStatusView,
  LocalAgentUpdateRequest
} from '../../shared/localAgents';
import { notify } from '../lib/notify';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    // IPC wraps main-process errors; strip the Electron prefix noise.
    return error.message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  }

  return String(error);
}

type LocalAgentsState = {
  agents: LocalAgentStatusView[];
  selectedAgentId: LocalAgentId | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Which agent is mid-probe; only one runs at a time. */
  probingAgentId: LocalAgentId | null;
  probes: Partial<Record<LocalAgentId, LocalAgentProbeResult>>;
  error: string | null;

  load: () => Promise<void>;
  select: (agentId: LocalAgentId) => void;
  update: (request: LocalAgentUpdateRequest) => Promise<boolean>;
  probe: (agentId: LocalAgentId) => Promise<void>;
  clearError: () => void;
};

export const useLocalAgentsStore = create<LocalAgentsState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  isLoading: false,
  isSaving: false,
  probingAgentId: null,
  probes: {},
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const agents = await window.atlasChat.localAgents.list();
      set((state) => ({
        agents,
        isLoading: false,
        // Land on something useful: the current pick if it survived, else the
        // first agent that is actually switched on, else the top of the list.
        selectedAgentId:
          agents.find((agent) => agent.id === state.selectedAgentId)?.id ??
          agents.find((agent) => agent.enabled)?.id ??
          agents[0]?.id ??
          null
      }));
    } catch (error) {
      set({ isLoading: false, error: getErrorMessage(error) });
    }
  },

  select: (agentId) => set({ selectedAgentId: agentId, error: null }),

  update: async (request) => {
    set({ isSaving: true, error: null });
    try {
      const agents = await window.atlasChat.localAgents.update(request);
      set({ agents, isSaving: false });
      // A configuration change invalidates whatever the last probe proved.
      if (request.enabled === undefined) {
        set((state) => ({ probes: { ...state.probes, [request.agentId]: undefined } }));
      }
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isSaving: false, error: message });
      notify({ tone: 'error', title: 'Agent settings not saved', description: message });
      return false;
    }
  },

  probe: async (agentId) => {
    set({ probingAgentId: agentId, error: null });
    try {
      const result = await window.atlasChat.localAgents.probe(agentId);
      set((state) => ({ probingAgentId: null, probes: { ...state.probes, [agentId]: result } }));
      notify({
        tone: result.status === 'ready' ? 'success' : result.status === 'warning' ? 'info' : 'error',
        title: `${get().agents.find((agent) => agent.id === agentId)?.label ?? agentId}: ${result.status}`,
        ...(result.message ? { description: result.message } : {})
      });
    } catch (error) {
      const message = getErrorMessage(error);
      set({ probingAgentId: null, error: message });
      notify({ tone: 'error', title: 'Check failed', description: message });
    }
  },

  clearError: () => set({ error: null })
}));
