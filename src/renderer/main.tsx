import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { initPostHog, syncTelemetryStatus } from './lib/posthog';
import './styles.css';
import './themes/xai.css';
import './themes/default.css';
import './themes/cursor.css';

initPostHog();
void syncTelemetryStatus();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
