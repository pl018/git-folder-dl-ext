# Browser Download Mode Design

**Date:** 2026-03-16

## Goal

Add an explicit browser-managed download mode that ignores direct folder access and sends selected files to Chrome's standard download flow.

## User-Facing Behavior

- A new `BROWSER DOWNLOAD MODE` toggle appears at the top of popup settings.
- When enabled:
  - the extension ignores target folder access and native folder linking
  - `AUTO MODE` is forced on
  - `OPEN FOLDER AFTER DOWNLOAD` is forced off
  - direct-save-only controls are disabled and visually marked as ignored
- Downloads follow Chrome's normal behavior:
  - if Chrome is configured to save automatically, files go to the browser default download location
  - if Chrome is configured to ask where to save, Chrome prompts according to its own settings

## Output Layout

- Browser mode still preserves repository structure.
- Files download under `<repo>/...` relative to the browser-managed download location.
- The direct-save-only `SUBFOLDER PREFIX` is ignored in browser mode.

## Architecture

### Popup

- Stores a new `browserDownloadMode` setting.
- Applies forced setting changes when browser mode is enabled:
  - `autoMode = true`
  - `openAfterDownload = false`
- Disables direct-save-only controls while browser mode is active.

### Content Script

- Branches early in `handleDownload()`.
- In browser mode:
  - skips File System Access permission checks
  - resolves the same manifest from the background with browser mode semantics
  - hands the manifest to a background browser-download queue
  - keeps the existing progress modal and batch cancel entry point

### Background

- Resolves download plans with `prefix = ''` when browser mode is active.
- Uses `chrome.downloads.download()` to submit files to Chrome's native download system.
- Tracks active browser download jobs in memory so cancel can stop the remaining queue and cancel any started downloads.

## Cancellation Semantics

- Browser mode cancel is batch-scoped.
- Cancel stops launching the rest of the files and cancels downloads already started by the job.
- Browser-managed downloads do not support the same direct-write rollback guarantees as File System Access mode, so this mode is best-effort cancellation rather than deterministic restore.

## Testing

- Add unit coverage for download-plan prefix behavior when browser mode is active.
- Add smoke coverage that popup settings render the new mode.
- Rebuild `dist/` and validate that the popup disables direct-save controls when browser mode is enabled.
