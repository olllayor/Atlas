# Manual Test: In-App Update Download (Unsigned DMG)

## Setup

1. **Start Atlas with a fake older version** (for testing):
   - Temporarily edit `package.json` version to `0.1.0` (or any version older than the latest GitHub release)
   - Run `npm run dev`
   - Verify in **Settings > App updates** that it shows "Atlas is up to date as of [timestamp]" (uses the old version)

2. **Restore the real version** once you've confirmed the old version shows:
   - Change `package.json` back to the actual version
   - Restart the dev server

---

## Test Case 1: Happy Path — Check, Download, and Open

### Preconditions
- Atlas is running with an old version (e.g., `0.1.0`)
- Network is working
- Latest GitHub release exists and has published DMG files

### Steps
1. Open **Settings > App updates**
2. Click **"Check now"** button
3. **Verify check result:**
   - Button shows "Checking…" with a spinning icon
   - After ~2–5 seconds, button changes to **"Download update"**
   - Description shows: `"Version X.X.X is available."`
   - Release notes appear below (if any)

4. Click **"Download update"** button
5. **Verify download starts:**
   - Button label changes to **"Downloading…"** with a spinning icon
   - Button is now **disabled**
   - Description updates to: `"Downloading Atlas X.X.X — 0%"` (live percentage)
   - Progress increments over time (% should increase)

6. **Wait for download to complete** (120–300 MB, depending on connection):
   - Percentage reaches 100%
   - Button label changes to **"Open installer"**
   - Description changes to: `"Atlas X.X.X is in your Downloads folder. Open it and drag Atlas to Applications."`
   - Progress bar disappears

7. Click **"Open installer"** button
8. **Verify installer opens:**
   - Finder window appears with the DMG mounted (or Finder opens to Downloads folder)
   - DMG name matches the release: `Atlas-X.X.X.dmg` or `Atlas-X.X.X-arm64.dmg`
   - You can see both **Atlas.app** and **Applications folder** (drag target) inside the DMG

9. **Verify cleanup:**
   - Check `~/Downloads/` — the `.dmg` file should be there (not `.dmg.part`)

---

## Test Case 2: Check Without Download

### Steps
1. Open **Settings > App updates**
2. Click **"Check now"** button
3. Wait for check to complete (should show "Download update" if a newer version exists)
4. **Do not click download** — just close settings
5. Open settings again
6. **Verify state persists:**
   - Button still shows **"Download update"**
   - Same version number is displayed
   - (The cached release info is retained across checks unless you check again)

---

## Test Case 3: Download Interruption (Quit During Download)

### Steps
1. Click **"Check now"** and wait for "Download update" button
2. Click **"Download update"** to start the download
3. Wait ~30 seconds (enough to see progress at say 10–20%)
4. **Quit Atlas** (Cmd+Q or close the window)
5. **Verify quit is fast:**
   - No hang or "saving" spinner
   - App closes within 1–2 seconds
   - Network socket is aborted immediately

6. **Verify partial file cleanup:**
   - Check `~/Downloads/` — there should be **no `.dmg.part` file**
   - Only completed downloads remain

---

## Test Case 4: Check While Downloading (Should Be Blocked)

### Steps
1. Start a download (see Test Case 1, step 4–5)
2. Wait ~30 seconds (progress at say 15%)
3. Try to click **"Check now"** button
4. **Verify button is disabled:**
   - Button does not respond to clicks
   - Download continues uninterrupted
   - Progress updates continue

---

## Test Case 5: No Matching Asset for Architecture

### Precondition
- Create a test GitHub release with **only an Intel DMG** (no arm64 variant)
- Temporarily point the check to that release (e.g., by modifying the test release URL)

### Steps
1. Click **"Check now"** on an Apple Silicon Mac
2. Wait for check to complete
3. **Verify fallback behavior:**
   - Button shows **"Download update"**
   - Click it
   - **Finder opens to the GitHub release page** (browser fallback)
   - No local download is attempted

---

## Test Case 6: Network Error During Check

### Steps
1. **Disconnect from the network** (disable Wi-Fi or unplug ethernet)
2. Click **"Check now"** button
3. Wait ~10 seconds
4. **Verify error handling:**
   - Button shows **"Check now"** (back to default)
   - Description shows: `"[error message]"` (in red/warning tone if styled)
   - Example: `"Unable to check for updates. GitHub returned [error code]"`

5. **Reconnect to the network**
6. Click **"Check now"** again
7. **Verify recovery:**
   - Check succeeds
   - Button shows "Download update" if a newer version exists

---

## Test Case 7: Network Error During Download

### Steps
1. Click **"Check now"** and wait for "Download update"
2. Click **"Download update"** to start
3. Wait ~30 seconds (download at say 20%)
4. **Disconnect from the network** (disable Wi-Fi)
5. **Verify download stops:**
   - Progress stops updating
   - After ~10 seconds, button reverts to **"Check now"**
   - Description shows an error message: e.g., `"Network error: Connection reset"`
   - `.dmg.part` file is cleaned up from Downloads

6. **Reconnect to the network**
7. Click **"Check now"** to re-check
8. **Re-attempt download** and verify it works this time

---

## Test Case 8: Verify Correct Architecture (Arm64 vs. x64)

### On Apple Silicon Mac
1. Click **"Check now"** → **"Download update"**
2. Monitor the download file name (via Finder, or logs if available)
3. **Verify DMG name contains `-arm64`:**
   - Expected: `Atlas-0.1.19-arm64.dmg`
   - Should NOT be: `Atlas-0.1.19.dmg` (Intel variant)

### On Intel Mac (if available)
1. Repeat steps 1–2
2. **Verify DMG name does NOT contain `-arm64`:**
   - Expected: `Atlas-0.1.19.dmg`
   - Should NOT be: `Atlas-0.1.19-arm64.dmg` (arm64 variant)

---

## Test Case 9: Progress Display Accuracy

### Steps
1. Start a download and observe the progress bar
2. **Verify progress updates:**
   - Percentage increments smoothly (not too jumpy, not stuck)
   - Updates roughly every 250ms (throttled, so not overwhelming)
   - Percentage is correct relative to time (e.g., at 30s of a 3min download, should be ~16%)
   - Reaches 100% when download completes

3. **Verify bytes display** (if shown in extended info):
   - `transferred` < `total` during download
   - `transferred` == `total` at 100%
   - `bytesPerSecond` is reasonable for your connection

---

## Test Case 10: Installer Already Downloaded (State Persistence)

### Steps
1. Complete a full download (see Test Case 1)
2. Note the file: `Atlas-X.X.X.dmg` in `~/Downloads/`
3. **Restart Atlas**
4. Open **Settings > App updates**
5. **Verify button still shows "Open installer":**
   - Clicking it opens the already-downloaded DMG
   - No re-download is attempted
   - (State must persist across app restart)

---

## Test Case 11: Release Notes Display

### Steps
1. Click **"Check now"** (assuming a newer version exists with release notes)
2. Wait for check to complete
3. **Verify release notes render below the button:**
   - Markdown is visible (if release notes are in markdown)
   - Formatting is readable
   - Long notes are scrollable or truncated gracefully

---

## Test Case 12: Concurrency — Rapid Clicks

### Steps
1. Click **"Check now"** button multiple times in quick succession
2. **Verify robustness:**
   - Only one check runs (the first click)
   - Other clicks are ignored (or queued once)
   - No UI corruption or duplicate network requests
   - Spinner and state remain consistent

---

## Checklist for Sign-Off

- [ ] Test Case 1: Happy path works end-to-end
- [ ] Test Case 2: State persists across settings close/reopen
- [ ] Test Case 3: Quit during download is fast and cleans up `.part` files
- [ ] Test Case 4: Download blocks re-check
- [ ] Test Case 5: No matching asset falls back to browser
- [ ] Test Case 6: Network errors during check show message
- [ ] Test Case 7: Network errors during download stop transfer and clean up
- [ ] Test Case 8: Correct DMG variant downloaded (arm64 on M-series, no suffix on Intel)
- [ ] Test Case 9: Progress bar updates reasonably (not stuck, not too jumpy)
- [ ] Test Case 10: Downloaded DMG persists across restart; "Open installer" still works
- [ ] Test Case 11: Release notes display if present
- [ ] Test Case 12: Rapid checks don't cause concurrency issues

---

## Debugging Notes

### Where to find logs
- **macOS:** Console.app → "Atlas" process, or `~/Library/Logs/Atlas/` if a log file is configured
- **Dev console:** DevTools (Cmd+Shift+I) → Console tab for renderer-side events

### Key things to log
- Add console.log in `performPrimaryAction()` when download starts
- Check browser DevTools → Network tab to see actual fetch requests
- Monitor `~/Downloads/` folder during test to watch file appear/rename

### If something breaks
1. **Check the render log** — any error messages in the Description field?
2. **Check the main process log** — any exceptions in UpdateService?
3. **Verify GitHub release** — does the latest release have `latest-mac.yml` and DMGs?
4. **Network connectivity** — run `curl https://api.github.com/repos/olllayor/Atlas/releases` manually

---

## Future: When Signing is Enabled

Once a Developer ID signing certificate is added:
- The button will launch a Squirrel.Mac silent background download
- The button label will change to **"Restart to install"** on completion
- No DMG will appear in Downloads (the swap is atomic via Squirrel)
- The flow will be completely hands-off
