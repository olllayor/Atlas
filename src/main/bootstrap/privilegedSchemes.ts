import { protocol } from 'electron/main';

import { MCP_UI_CUSTOM_SCHEME } from '../ai/mcp/mcpUiProtocol';
import { NATIVE_APP_ICON_CUSTOM_SCHEME } from '../assets/nativeAppIconProtocol';
import { ATTACHMENT_CUSTOM_SCHEME } from '../attachments/attachmentProtocol';
import { PLUGIN_ICON_CUSTOM_SCHEME } from '../plugins/pluginIconProtocol';
import { SITE_PREVIEW_CUSTOM_SCHEME } from '../sites/SitePreviewHost';
import { ATLAS_CUSTOM_SCHEME } from './deepLink';

/**
 * Every custom scheme, declared in a single `registerSchemesAsPrivileged` call.
 *
 * The single call is the whole point. Electron accumulates `standard` and
 * `stream` across calls but *overwrites* `secure`, `supportFetchAPI` and
 * `corsEnabled` with whichever later call declares them, so six modules each
 * registering their own scheme left only the last one of each holding those
 * privileges. `atlas-attachment` lost `supportFetchAPI` that way: stored images
 * still rendered (an `<img>` needs nothing beyond a handler) while every
 * `fetch()` of the same URL failed, which is what copying or saving one does —
 * hence "The image could not be read." on a picture visibly on screen.
 *
 * Must run before `app.whenReady()`; privileged schemes cannot be added later.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    SITE_PREVIEW_CUSTOM_SCHEME,
    ATTACHMENT_CUSTOM_SCHEME,
    PLUGIN_ICON_CUSTOM_SCHEME,
    NATIVE_APP_ICON_CUSTOM_SCHEME,
    ATLAS_CUSTOM_SCHEME,
    MCP_UI_CUSTOM_SCHEME,
  ]);
}
