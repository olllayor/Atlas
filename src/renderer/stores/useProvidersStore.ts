import { create } from 'zustand';

import type { ProviderId } from '../../shared/contracts';
import type {
  CreateCustomProviderRequest,
  CustomProvider,
  CustomProviderApiFormat,
  CustomProviderModel,
  CustomProviderModelInput,
  DiscoveredModel,
  ProviderPreset,
  UpdateCustomProviderRequest
} from '../../shared/customProviders';
import { notify } from '../lib/notify';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    // IPC wraps main-process errors; strip the Electron prefix noise.
    return error.message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  }

  return String(error);
}

/** `null` selects the "add provider" form rather than an existing provider. */
export type ProviderSelection = ProviderId | null;

type ProvidersState = {
  providers: CustomProvider[];
  selectedProviderId: ProviderSelection;
  isLoading: boolean;
  isSaving: boolean;
  isDiscovering: boolean;
  discovered: DiscoveredModel[] | null;
  presets: ProviderPreset[];
  error: string | null;

  load: () => Promise<void>;
  loadPresets: () => Promise<void>;
  select: (providerId: ProviderSelection) => void;
  create: (request: CreateCustomProviderRequest) => Promise<CustomProvider | null>;
  update: (request: UpdateCustomProviderRequest) => Promise<void>;
  remove: (providerId: ProviderId) => Promise<void>;
  setModels: (providerId: ProviderId, models: CustomProviderModelInput[]) => Promise<void>;
  addModel: (providerId: ProviderId, model: CustomProviderModelInput) => Promise<void>;
  updateModel: (providerId: ProviderId, modelId: string, patch: Partial<CustomProviderModel>) => Promise<void>;
  removeModel: (providerId: ProviderId, modelId: string) => Promise<void>;
  discoverModels: (request: {
    providerId?: ProviderId;
    baseUrl?: string;
    apiFormat?: CustomProviderApiFormat;
    apiKey?: string;
  }) => Promise<DiscoveredModel[]>;
  testConnection: (request: {
    providerId?: ProviderId;
    baseUrl?: string;
    apiFormat?: CustomProviderApiFormat;
    apiKey?: string;
  }) => Promise<boolean>;
  clearDiscovered: () => void;
};

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  selectedProviderId: null,
  isLoading: false,
  isSaving: false,
  isDiscovering: false,
  discovered: null,
  presets: [],
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await window.atlasChat.providers.list();
      set((state) => ({
        providers,
        isLoading: false,
        // Keep the current selection only if it still exists.
        selectedProviderId: providers.some((provider) => provider.id === state.selectedProviderId)
          ? state.selectedProviderId
          : null
      }));
    } catch (error) {
      set({ isLoading: false, error: getErrorMessage(error) });
    }
  },

  loadPresets: async () => {
    if (get().presets.length > 0) {
      return;
    }

    try {
      set({ presets: await window.atlasChat.providers.listPresets() });
    } catch {
      // Presets are a convenience; typing a base URL by hand still works.
    }
  },

  select: (providerId) => set({ selectedProviderId: providerId, discovered: null, error: null }),

  create: async (request) => {
    set({ isSaving: true, error: null });
    try {
      const created = await window.atlasChat.providers.create(request);
      const providers = await window.atlasChat.providers.list();
      set({ providers, isSaving: false, selectedProviderId: created.id, discovered: null });
      notify({ tone: 'success', title: `${created.name} added.` });
      return created;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isSaving: false, error: message });
      notify({ tone: 'error', title: message });
      return null;
    }
  },

  update: async (request) => {
    set({ isSaving: true, error: null });
    try {
      await window.atlasChat.providers.update(request);
      const providers = await window.atlasChat.providers.list();
      set({ providers, isSaving: false });
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isSaving: false, error: message });
      notify({ tone: 'error', title: message });
    }
  },

  remove: async (providerId) => {
    const name = get().providers.find((provider) => provider.id === providerId)?.name ?? 'Provider';
    set({ isSaving: true, error: null });
    try {
      await window.atlasChat.providers.delete(providerId);
      const providers = await window.atlasChat.providers.list();
      set({ providers, isSaving: false, selectedProviderId: null, discovered: null });
      notify({ tone: 'success', title: `${name} removed.` });
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isSaving: false, error: message });
      notify({ tone: 'error', title: message });
    }
  },

  setModels: async (providerId, models) => {
    set({ isSaving: true, error: null });
    try {
      await window.atlasChat.providers.setModels({ providerId, models });
      const providers = await window.atlasChat.providers.list();
      set({ providers, isSaving: false });
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isSaving: false, error: message });
      notify({ tone: 'error', title: message });
    }
  },

  addModel: async (providerId, model) => {
    const provider = get().providers.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }

    if (provider.models.some((entry) => entry.id === model.id.trim())) {
      notify({ tone: 'error', title: 'That model is already in the list.' });
      return;
    }

    await get().setModels(providerId, [...provider.models, model]);
  },

  updateModel: async (providerId, modelId, patch) => {
    const provider = get().providers.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }

    await get().setModels(
      providerId,
      provider.models.map((entry) => (entry.id === modelId ? { ...entry, ...patch } : entry))
    );
  },

  removeModel: async (providerId, modelId) => {
    const provider = get().providers.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }

    await get().setModels(
      providerId,
      provider.models.filter((entry) => entry.id !== modelId)
    );
  },

  discoverModels: async (request) => {
    set({ isDiscovering: true, error: null });
    try {
      const discovered = await window.atlasChat.providers.discoverModels(request);
      set({ isDiscovering: false, discovered });

      if (discovered.length === 0) {
        notify({ tone: 'error', title: 'The endpoint returned no models. Add them by hand.' });
      }

      return discovered;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isDiscovering: false, error: message });
      notify({ tone: 'error', title: message });
      return [];
    }
  },

  testConnection: async (request) => {
    set({ isDiscovering: true, error: null });
    try {
      await window.atlasChat.providers.testConnection(request);
      set({ isDiscovering: false });
      notify({ tone: 'success', title: 'Endpoint reachable and key accepted.' });
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      set({ isDiscovering: false, error: message });
      notify({ tone: 'error', title: message });
      return false;
    }
  },

  clearDiscovered: () => set({ discovered: null })
}));
