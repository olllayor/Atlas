import type { ModelSummary } from './contracts';

const now = () => new Date().toISOString();

export function getGlmSeedModels(): ModelSummary[] {
  const timestamp = now();

  return [
    {
      id: 'glm-5',
      providerId: 'glm',
      label: 'GLM-5',
      contextWindow: 200_000,
      isFree: false,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: null
    },
    {
      id: 'glm-5-turbo',
      providerId: 'glm',
      label: 'GLM-5-Turbo',
      contextWindow: 200_000,
      isFree: false,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: null
    },
    {
      id: 'glm-4.7',
      providerId: 'glm',
      label: 'GLM-4.7',
      contextWindow: 200_000,
      isFree: false,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: null
    },
    {
      id: 'glm-4.7-flash',
      providerId: 'glm',
      label: 'GLM-4.7-Flash',
      contextWindow: 200_000,
      isFree: true,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: timestamp
    },
    {
      id: 'glm-4.5-air',
      providerId: 'glm',
      label: 'GLM-4.5-Air',
      contextWindow: 128_000,
      isFree: false,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: null
    },
    {
      id: 'glm-4.5-flash',
      providerId: 'glm',
      label: 'GLM-4.5-Flash',
      contextWindow: 200_000,
      isFree: true,
      supportsVision: false,
      supportsTools: false,
      archived: false,
      lastSyncedAt: timestamp,
      lastSeenFreeAt: timestamp
    }
  ];
}
