import { BrowserWindow, ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProviderId, SettingsUpdateRequest } from '../../shared/contracts';
import { isVisualMode } from '../../shared/visualIntent';
import type { ModelRegistry } from '../ai/core/ModelRegistry';
import {
  OPAQUE_WINDOW_BACKGROUND,
  VIBRANT_WINDOW_BACKGROUND,
  syncNativeTheme,
} from '../bootstrap/createWindow';
import type { SettingsRepo } from '../db/repositories/settingsRepo';
import type { KeychainStore } from '../secrets/keychain';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

type SettingsIpcDeps = {
  settingsRepo: SettingsRepo;
  modelRegistry: ModelRegistry;
  keychain: KeychainStore;
};

export function registerSettingsIpc({ settingsRepo, modelRegistry, keychain }: SettingsIpcDeps) {
  ipcMain.handle(
    IPC_CHANNELS.settingsGetSummary,
    withUserFacingErrors(IPC_CHANNELS.settingsGetSummary, (event) => {
      assertTrustedSender(event);
      return modelRegistry.getSettingsSummary();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsSaveProviderKey,
    withUserFacingErrors(IPC_CHANNELS.settingsSaveProviderKey, async (event, providerId: ProviderId, secret: string) => {
      assertTrustedSender(event);

      const trimmed = secret.trim();
      if (!trimmed) {
        throw new Error('Provider API key cannot be empty.');
      }

      await keychain.setSecret(providerId, trimmed);
      settingsRepo.updateCredentialStatus(providerId, {
        hasSecret: true,
        status: 'unknown',
        validatedAt: null
      });

      return modelRegistry.getSettingsSummary();
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsValidateProviderKey,
    withUserFacingErrors(
      IPC_CHANNELS.settingsValidateProviderKey,
      async (event, providerId: ProviderId, secret?: string) => {
        assertTrustedSender(event);
        await modelRegistry.validateProviderKey(providerId, secret);
        return modelRegistry.getSettingsSummary();
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsUpdatePreferences,
    withUserFacingErrors(IPC_CHANNELS.settingsUpdatePreferences, (event, patch: SettingsUpdateRequest) => {
      assertTrustedSender(event);
      const appearancePatch = patch?.appearance;

      if (typeof patch?.showFreeOnlyByDefault === 'boolean') {
        settingsRepo.setShowFreeOnlyByDefault(patch.showFreeOnlyByDefault);
      }

      if (appearancePatch?.themeMode) {
        settingsRepo.setThemeMode(appearancePatch.themeMode);
        // Keeps the vibrancy material on the same appearance as the page.
        syncNativeTheme(appearancePatch.themeMode);
      }

      if (appearancePatch?.designTheme) {
        settingsRepo.setDesignTheme(appearancePatch.designTheme);
      }

      if (typeof appearancePatch?.uiFontSize === 'number') {
        settingsRepo.setUiFontSize(appearancePatch.uiFontSize);
      }

      if (typeof appearancePatch?.codeFontSize === 'number') {
        settingsRepo.setCodeFontSize(appearancePatch.codeFontSize);
      }

      if (appearancePatch && 'uiFontFamily' in appearancePatch) {
        settingsRepo.setUiFontFamily(appearancePatch.uiFontFamily ?? null);
      }

      if (appearancePatch && 'codeFontFamily' in appearancePatch) {
        settingsRepo.setCodeFontFamily(appearancePatch.codeFontFamily ?? null);
      }

      if (appearancePatch?.borderRadius) {
        settingsRepo.setBorderRadius(appearancePatch.borderRadius);
      }

      if (appearancePatch && 'accentColor' in appearancePatch) {
        settingsRepo.setThemeColor('accentColor', appearancePatch.accentColor ?? null);
      }

      if (appearancePatch && 'backgroundColor' in appearancePatch) {
        settingsRepo.setThemeColor('backgroundColor', appearancePatch.backgroundColor ?? null);
      }

      if (appearancePatch && 'foregroundColor' in appearancePatch) {
        settingsRepo.setThemeColor('foregroundColor', appearancePatch.foregroundColor ?? null);
      }

      if (typeof appearancePatch?.contrast === 'number') {
        settingsRepo.setContrast(appearancePatch.contrast);
      }

      if (typeof appearancePatch?.translucentSidebar === 'boolean') {
        settingsRepo.setTranslucentSidebar(appearancePatch.translucentSidebar);

        // Best-effort live apply. A fresh window still renders it better:
        // `visualEffectState: 'active'` is a construction-time option with no
        // setter, so a window switched on mid-session desaturates its material
        // whenever it loses focus until the next launch.
        if (process.platform === 'darwin') {
          for (const window of BrowserWindow.getAllWindows()) {
            window.setVibrancy(appearancePatch.translucentSidebar ? 'sidebar' : null);
            window.setBackgroundColor(
              appearancePatch.translucentSidebar ? VIBRANT_WINDOW_BACKGROUND : OPAQUE_WINDOW_BACKGROUND
            );
          }
        }
      }

      if (appearancePatch?.reduceMotion) {
        settingsRepo.setReduceMotion(appearancePatch.reduceMotion);
      }

      if (typeof appearancePatch?.pointerCursors === 'boolean') {
        settingsRepo.setPointerCursors(appearancePatch.pointerCursors);
      }

      if (typeof appearancePatch?.rawTranscript === 'boolean') {
        settingsRepo.setRawTranscript(appearancePatch.rawTranscript);
      }

      if (patch?.keyboard?.keybindings) {
        settingsRepo.setKeybindings(patch.keyboard.keybindings);
      }

      if (patch?.chat?.reasoningEffort) {
        settingsRepo.setReasoningEffort(patch.chat.reasoningEffort);
      }

      if (patch?.chat?.toolPermissionMode) {
        settingsRepo.setToolPermissionMode(patch.chat.toolPermissionMode);
      }

      if (patch?.chat?.workspaceMode) {
        settingsRepo.setWorkspaceMode(patch.chat.workspaceMode);
      }

      if (patch?.chat?.lastProjectId !== undefined) {
        settingsRepo.setLastProjectId(patch.chat.lastProjectId);
      }

      if (patch?.chat?.lastModelId) {
        settingsRepo.setLastModelId(patch.chat.lastModelId);
      }

      // Validated here rather than trusted: the renderer supplies this value.
      if (isVisualMode(patch?.chat?.visualMode)) {
        settingsRepo.setVisualMode(patch.chat.visualMode);
      }

      return modelRegistry.getSettingsSummary();
    })
  );
}
