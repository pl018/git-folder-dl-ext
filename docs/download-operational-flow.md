# Download Operational Flow

## Purpose

This extension performs automated GitHub file and folder downloads by writing
directly into a user-granted folder. It does not use browser-managed per-file
downloads in the automated path.

## Runtime Flow

1. The content script collects the current GitHub selections from injected checkboxes.
2. The download button click is treated as the only user gesture needed for folder access.
3. `file-writer.js` ensures a stored directory handle exists and has `readwrite` permission.
4. If access is missing or expired, the user reauthorizes once before any manifest work proceeds.
5. The content script requests a resolved download plan from the service worker.
6. The service worker fetches repository metadata, resolves the tree, and returns a deduplicated manifest.
7. The content script fetches file bodies and writes them directly to disk using the File System Access API.
8. The extension records repo metadata, selections, resolved files, and timestamps in local history.
9. If enabled, a `.gfdl-download.json` marker is written at the downloaded repo root after a clean direct-write run.
10. Auto mode clears the selection and closes the progress UI after a successful run.

## Output Contract

- Root path is always `<target-folder>/<optional-prefix>/<repo>/`.
- Selected files are written at their repository-relative path under that root.
- Selected folders preserve full repository-relative structure under that root.
- Overlapping selections are deduplicated by repository path before writing.
- History records always store the logical root path and best-effort native path metadata when a linked OS path exists.

## Failure States

- `folder-missing`: no stored handle exists. The user must choose a target folder.
- `folder-access-expired`: a handle exists but write permission is no longer granted.
- Manifest resolution failure: GitHub tree lookup or selection resolution returned no files.
- File write failure: fetch or write failed for an individual entry; the run completes with per-file errors.
- History mirror failure: the native helper or SQLite CLI was unavailable; downloads still complete and extension history still records the run.

## Support Notes

- If users report browser save prompts, the direct-write flow was not active or folder access was not granted.
- If users say files land in the browser Downloads folder, check that they are running the updated build and that no legacy extension build is loaded.
- If users report duplicate files after mixed selections, verify the current build includes `download-plan.js` and dedupe logic in the resolved manifest path.
- If users do not see SQL history, verify the native helper is installed and `sqlite3.exe` is available to the helper environment.

## Manual Verification Checklist

- Grant a target folder and download a single file: confirm it lands in `<target>/<repo>/...`.
- Download a folder: confirm nested structure is preserved.
- Select a folder and a file inside that folder: confirm the nested file is written once.
- Enable auto mode: confirm the selection clears and the modal closes after a clean download.
- Remove folder access or clear the stored handle: confirm the next download requires reauthorization and does not fall back to browser downloads.
- Test a private repository with a valid token: confirm files still write directly to the target folder.
