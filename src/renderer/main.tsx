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

console.info(`[perf] renderer:main.tsx evaluated at +${Math.round(performance.now())}ms (since renderer nav start)`);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// First paint (module eval → first rAF after React commits). Off the React
// lifecycle on purpose: an effect runs before paint and would flatter the number.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    console.info(`[perf] renderer:first-paint at +${Math.round(performance.now())}ms`);
  });
});
