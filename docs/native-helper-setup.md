# Native Helper Setup

## What It Does

The extension can write files directly through the File System Access API, but
that API does not expose the real OS path of the chosen folder. A small native
helper is used on Windows only for OS-level actions:

- choosing a real folder path to link with Explorer
- opening that linked folder after a successful download

## Install

1. Build and load the unpacked extension from `dist/`.
2. Open the popup and copy the shown extension ID.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-native-host.ps1 -ExtensionId <extension-id>
```

4. Reload the extension in `chrome://extensions`.

## Configure

1. Use `TARGET FOLDER ACCESS` to grant the folder the extension should write to.
2. Use `OPEN FOLDER LINK` and pick the same folder path in the native helper dialog.
3. Enable `OPEN FOLDER AFTER DOWNLOAD`.

If you later change the granted folder, the linked OS path is cleared and must
be linked again.

## Files

- `native-host/host.js` — native messaging host entry point
- `scripts/install-native-host.ps1` — registers the host in the current user registry

## Limitations

- This helper is Windows-focused and opens folders through Explorer.
- The extension still cannot silently reauthorize File System Access permissions if Chrome revokes them.
- The linked OS folder path is stored separately from the browser handle because the browser handle does not expose an absolute filesystem path.
