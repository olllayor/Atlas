import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { initPostHog, syncTelemetryStatus } from './lib/posthog';
import { isMacPlatform } from './lib/platform';
import { stampCachedTranslucentSidebar } from './lib/translucentSidebar';
import './styles.css';
import 'slot-text/style.css';
import './themes/xai.css';
import './themes/default.css';
import './themes/landing.css';
import './themes/cursor.css';
import './themes/codex.css';

initPostHog();
void syncTelemetryStatus();

// Before the first paint, not in an effect: the sidebar renders opaque until
// this attribute lands, and a late stamp reads as a flash on every launch.
stampCachedTranslucentSidebar(isMacPlatform);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
