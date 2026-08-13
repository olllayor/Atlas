import { create } from 'zustand';

import type {
  SiteDetail,
  SiteExportFormat,
  SitePreviewTarget,
  SiteReviewChecklist,
  SiteSummary,
  SiteViolationCode,
} from '../../shared/sites';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    // IPC wraps main-process errors; strip the Electron prefix noise.
    return error.message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  }
  return String(error);
}

type SitesState = {
  sites: SiteSummary[];
  detail: SiteDetail | null;
  selectedSiteId: string | null;
  selectedFilePath: string | null;
  fileContents: string | null;
  fileDirty: boolean;
  review: SiteReviewChecklist | null;
  previewTarget: SitePreviewTarget | null;
  previewNonce: number;
  acknowledgedWarnings: SiteViolationCode[];
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;

  loadSites: () => Promise<void>;
  selectSite: (siteId: string | null) => Promise<void>;
  refreshDetail: (siteId?: string) => Promise<void>;
  createSite: (title: string, sourceConversationId?: string | null) => Promise<void>;
  renameSite: (siteId: string, title: string) => Promise<void>;
  deleteSite: (siteId: string) => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  /** Opens an unsaved, empty buffer for a path that does not exist yet. */
  createDraftFile: (path: string) => void;
  setFileContents: (contents: string) => void;
  saveFile: () => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  build: () => Promise<void>;
  refreshReview: () => Promise<void>;
  toggleWarningAcknowledged: (code: SiteViolationCode) => void;
  publish: (label?: string) => Promise<void>;
  unpublish: () => Promise<void>;
  rollback: (versionId: string) => Promise<void>;
  resetDraft: (versionId: string) => Promise<void>;
  refreshPreview: (versionId?: string | null) => Promise<void>;
  openPreviewWindow: (versionId?: string | null) => Promise<void>;
  exportSite: (format: SiteExportFormat, versionId?: string | null) => Promise<string | null>;
  openInBrowser: (versionId?: string | null) => Promise<void>;
  clearError: () => void;
};

export const useSitesStore = create<SitesState>((set, get) => {
  /** Run a mutating call, keep detail/review/preview in step, surface failures. */
  const withBusy = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    set({ isBusy: true, error: null });
    try {
      return await operation();
    } catch (error) {
      set({ error: getErrorMessage(error) });
      return null;
    } finally {
      set({ isBusy: false });
    }
  };

  const applyDetail = (detail: SiteDetail) => {
    const state = get();
    const stillExists = detail.files.some((file) => file.path === state.selectedFilePath);
    set({
      detail,
      selectedSiteId: detail.site.id,
      selectedFilePath: stillExists ? state.selectedFilePath : null,
      fileContents: stillExists ? state.fileContents : null,
      fileDirty: stillExists ? state.fileDirty : false,
    });
  };

  return {
    sites: [],
    detail: null,
    selectedSiteId: null,
    selectedFilePath: null,
    fileContents: null,
    fileDirty: false,
    review: null,
    previewTarget: null,
    previewNonce: 0,
    acknowledgedWarnings: [],
    isLoading: false,
    isBusy: false,
    error: null,

    loadSites: async () => {
      set({ isLoading: true, error: null });
      try {
        const sites = await window.atlasChat.sites.list();
        set({ sites });

        const selectedSiteId = get().selectedSiteId;
        if (selectedSiteId && !sites.some((site) => site.id === selectedSiteId)) {
          set({ selectedSiteId: null, detail: null, review: null, previewTarget: null });
        }
      } catch (error) {
        set({ error: getErrorMessage(error) });
      } finally {
        set({ isLoading: false });
      }
    },

    selectSite: async (siteId) => {
      if (!siteId) {
        set({
          selectedSiteId: null,
          detail: null,
          review: null,
          previewTarget: null,
          selectedFilePath: null,
          fileContents: null,
          fileDirty: false,
        });
        return;
      }

      set({ selectedSiteId: siteId, selectedFilePath: null, fileContents: null, fileDirty: false });
      await get().refreshDetail(siteId);
      await get().refreshPreview();
      await get().refreshReview();
    },

    refreshDetail: async (siteId) => {
      const targetId = siteId ?? get().selectedSiteId;
      if (!targetId) return;
      try {
        applyDetail(await window.atlasChat.sites.get(targetId));
      } catch (error) {
        set({ error: getErrorMessage(error) });
      }
    },

    createSite: async (title, sourceConversationId) => {
      const detail = await withBusy(() =>
        window.atlasChat.sites.create({ title, sourceConversationId: sourceConversationId ?? null })
      );
      if (!detail) return;
      await get().loadSites();
      await get().selectSite(detail.site.id);
    },

    renameSite: async (siteId, title) => {
      const detail = await withBusy(() => window.atlasChat.sites.rename(siteId, title));
      if (!detail) return;
      applyDetail(detail);
      await get().loadSites();
    },

    deleteSite: async (siteId) => {
      const result = await withBusy(async () => {
        await window.atlasChat.sites.delete(siteId);
        return true;
      });
      if (!result) return;
      if (get().selectedSiteId === siteId) await get().selectSite(null);
      await get().loadSites();
    },

    selectFile: async (path) => {
      if (!path) {
        set({ selectedFilePath: null, fileContents: null, fileDirty: false });
        return;
      }

      const siteId = get().selectedSiteId;
      if (!siteId) return;

      set({ selectedFilePath: path, fileContents: null, fileDirty: false, error: null });
      try {
        const contents = await window.atlasChat.sites.readFile({ siteId, path });
        // Guard against an out-of-order response after the user moved on.
        if (get().selectedFilePath === path) set({ fileContents: contents, fileDirty: false });
      } catch (error) {
        set({ error: getErrorMessage(error), fileContents: null });
      }
    },

    /**
     * A brand-new file exists only as an unsaved buffer until `saveFile`
     * writes it, so there is nothing to read from disk — the empty contents
     * and the dirty flag *are* the file.
     */
    createDraftFile: (path) => set({ selectedFilePath: path, fileContents: '', fileDirty: true }),

    setFileContents: (contents) => set({ fileContents: contents, fileDirty: true }),

    saveFile: async () => {
      const { fileContents, selectedFilePath, selectedSiteId } = get();
      if (!selectedSiteId || !selectedFilePath || fileContents == null) return;

      const detail = await withBusy(() =>
        window.atlasChat.sites.writeFile({
          siteId: selectedSiteId,
          path: selectedFilePath,
          contents: fileContents,
        })
      );
      if (!detail) return;

      applyDetail(detail);
      set({ fileDirty: false });
      await get().refreshPreview();
    },

    deleteFile: async (path) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;

      const detail = await withBusy(() => window.atlasChat.sites.deleteFile({ siteId, path }));
      if (!detail) return;

      applyDetail(detail);
      if (get().selectedFilePath === path) {
        set({ selectedFilePath: null, fileContents: null, fileDirty: false });
      }
      await get().refreshPreview();
    },

    build: async () => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;

      const detail = await withBusy(() => window.atlasChat.sites.build(siteId));
      if (!detail) return;

      applyDetail(detail);
      await get().refreshReview();
      await get().refreshPreview();
    },

    refreshReview: async () => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;
      try {
        set({ review: await window.atlasChat.sites.review(siteId) });
      } catch (error) {
        set({ error: getErrorMessage(error) });
      }
    },

    toggleWarningAcknowledged: (code) =>
      set((state) => ({
        acknowledgedWarnings: state.acknowledgedWarnings.includes(code)
          ? state.acknowledgedWarnings.filter((entry) => entry !== code)
          : [...state.acknowledgedWarnings, code],
      })),

    publish: async (label) => {
      const { acknowledgedWarnings, selectedSiteId } = get();
      if (!selectedSiteId) return;

      const detail = await withBusy(() =>
        window.atlasChat.sites.publish({
          siteId: selectedSiteId,
          label: label ?? null,
          acknowledgedWarnings,
        })
      );
      if (!detail) return;

      applyDetail(detail);
      set({ acknowledgedWarnings: [] });
      await get().loadSites();
      await get().refreshReview();
      await get().refreshPreview();
    },

    unpublish: async () => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;

      const detail = await withBusy(() => window.atlasChat.sites.unpublish(siteId));
      if (!detail) return;

      applyDetail(detail);
      await get().loadSites();
    },

    rollback: async (versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;

      const detail = await withBusy(() => window.atlasChat.sites.rollback({ siteId, versionId }));
      if (!detail) return;

      applyDetail(detail);
      await get().loadSites();
      await get().refreshPreview();
    },

    resetDraft: async (versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;

      const detail = await withBusy(() => window.atlasChat.sites.resetDraft({ siteId, versionId }));
      if (!detail) return;

      applyDetail(detail);
      set({ selectedFilePath: null, fileContents: null, fileDirty: false });
      await get().refreshReview();
      await get().refreshPreview();
    },

    refreshPreview: async (versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;
      try {
        const target = await window.atlasChat.sites.previewTarget({ siteId, versionId: versionId ?? null });
        set((state) => ({ previewTarget: target, previewNonce: state.previewNonce + 1 }));
      } catch (error) {
        set({ error: getErrorMessage(error), previewTarget: null });
      }
    },

    openPreviewWindow: async (versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;
      await withBusy(() =>
        window.atlasChat.sites.openPreviewWindow({ siteId, versionId: versionId ?? null })
      );
    },

    exportSite: async (format, versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return null;

      const result = await withBusy(() =>
        window.atlasChat.sites.export({ siteId, versionId: versionId ?? null, format })
      );
      return result && !result.cancelled ? result.destination : null;
    },

    openInBrowser: async (versionId) => {
      const siteId = get().selectedSiteId;
      if (!siteId) return;
      await withBusy(() => window.atlasChat.sites.openInBrowser(siteId, versionId ?? null));
    },

    clearError: () => set({ error: null }),
  };
});
