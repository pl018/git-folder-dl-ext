# Browser Download Mode Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an explicit browser-managed download mode that bypasses target-folder access and routes selected files through Chrome's native download behavior.

**Architecture:** The popup owns the mode switch and forced-setting behavior. The content script branches between direct-write mode and browser-download mode, while the background service worker resolves the same manifest and submits browser downloads through `chrome.downloads` with batch cancellation support.

**Tech Stack:** Chrome Extension Manifest V3, content scripts, background service worker, `chrome.downloads`, File System Access API, Node.js unit tests, esbuild.

---

### Task 1: Persist Browser Download Mode

**Files:**
- Modify: `src/lib/storage.js`

**Step 1: Add storage default**

- Add `browserDownloadMode: false` to the default storage contract.

**Step 2: Verify callers can read it**

- Ensure existing `chrome.storage.local.get(...)` reads include this new key where relevant.

### Task 2: Add Popup Mode Toggle And Disabled State

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`
- Modify: `src/popup/popup.js`

**Step 1: Add the new toggle at the top of settings**

- Render a `BROWSER DOWNLOAD MODE` toggle above folder-based controls.

**Step 2: Apply forced-setting behavior**

- When enabled, persist:
  - `browserDownloadMode = true`
  - `autoMode = true`
  - `openAfterDownload = false`

**Step 3: Disable ignored controls**

- Disable and visually mute:
  - target folder access
  - open folder link
  - subfolder prefix
  - open folder after download
  - auto mode toggle

**Step 4: Add explanatory hints**

- Make the popup explain that browser mode follows Chrome's save behavior and ignores direct folder access.

### Task 3: Add Browser Download Queue In The Background

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `src/manifest.json`

**Step 1: Add downloads permission**

- Add `"downloads"` to extension permissions.

**Step 2: Extend plan resolution**

- Allow `RESOLVE_DOWNLOAD_PLAN` to accept `browserDownloadMode` and ignore the direct-save prefix when that mode is active.

**Step 3: Add browser queue messages**

- Add background handlers for:
  - `START_BROWSER_DOWNLOAD_JOB`
  - `CANCEL_BROWSER_DOWNLOAD_JOB`

**Step 4: Track active jobs**

- Keep job state in memory so a cancel request can stop unstarted downloads and cancel active ones.

### Task 4: Branch The Content Flow

**Files:**
- Modify: `src/content/main.js`

**Step 1: Read browser mode before folder preparation**

- Load `browserDownloadMode` and branch early.

**Step 2: Keep direct-write flow unchanged**

- Existing File System Access behavior remains the default path when browser mode is off.

**Step 3: Add browser-download path**

- Resolve a manifest with browser-mode semantics.
- Start the browser-managed job in the background.
- Reuse the progress modal for queue progress and completion messaging.

**Step 4: Add cancel wiring**

- Route modal cancel to the background browser job when browser mode is active.

### Task 5: Add Regression Coverage

**Files:**
- Modify: `test/unit/download-plan.test.js`
- Modify: `test/cdp/harness.js`

**Step 1: Add plan assertions**

- Verify browser mode ignores the stored prefix and still roots output at `<repo>/...`.

**Step 2: Update smoke harness**

- Verify the popup includes the new browser mode setting.

### Task 6: Rebuild And Validate

**Files:**
- Modify: `dist/manifest.json`
- Modify: `dist/background/service-worker.js`
- Modify: `dist/content/main.js`
- Modify: `dist/popup/popup.html`
- Modify: `dist/popup/popup.css`
- Modify: `dist/popup/popup.js`

**Step 1: Build**

Run: `node scripts/build.js`

**Step 2: Run unit tests**

Run: `node --test test/unit/`

**Step 3: Manual validation**

- Turn browser mode on in the popup.
- Confirm folder controls are disabled.
- Start a download and confirm Chrome handles the save behavior.
- Cancel a multi-file browser-mode download and confirm the remaining queue stops.
