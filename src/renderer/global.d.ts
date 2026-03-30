import type { RendererApi } from '../shared/contracts';

declare global {
  interface Window {
    cheapChat: RendererApi;
  }
}

export {};
