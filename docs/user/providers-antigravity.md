# Antigravity Provider

Google ships an official Antigravity ACP agent. Atlas installs and drives it directly over stdio.

## Resuming Threads and Saved Sign-in

After an environment or application restarts, Google sign-in can show as not checked until an authenticated session succeeds. You can continue an existing thread. Antigravity checks saved Google sign-in when the session starts. An unchecked status (`unknown`) does not require signing in again.

To check account access and reload models, open **Settings → Providers → Local agents** and test the connection. Refresh uses saved Google sign-in and does not open a login page if valid credentials exist. If sign-in is required, use the provider's setup controls. Automatic status checks verify the installation only.

The packaged runtime can be slow to start, especially on Windows. Health checks, model refresh, and sign-out each allow up to 90 seconds before reporting a timeout.
