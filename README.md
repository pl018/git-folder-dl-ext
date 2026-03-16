# GitHub Folder Downloader (GFDL)

Chrome extension (Manifest V3) that lets you select and download folders from any GitHub repository as actual file structures — no zipping.

## Features

- **Checkbox selection** on GitHub file browser rows (ghost-on-hover, shift+click range select)
- **Direct folder writes** into a granted target folder with no per-file browser save prompts
- **Deterministic output layout** under `<target>/<optional-prefix>/<repo>/...`
- **Deduplicated mixed selections** so folder + nested file selections only save once
- **Auto mode**: download, clear selections, and close progress automatically
- **Recent download history** with repo URL, owner/repo, timestamp, branch/SHA, and destination summary
- **Local SQL mirror** through the Windows native helper when available
- **Optional repo marker file** for future move/version reconciliation
- **Filename fallback** for dotfiles or Windows-invalid names when the platform rejects the original target path
- **GitHub auth**: OAuth Device Flow or Personal Access Token
- **Neobrutalist dark UI**: lime `#ccff00` accent on dark `#09090b`, hard shadows, uppercase labels

## Setup

```bash
npm install
npm run build
```

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder
4. Navigate to any GitHub repo

## Configuration

Click the extension icon to open the popup:

- **Authentication** — Paste a GitHub PAT (`ghp_...`) for private repo access
- **Target Folder Access** — Grant a folder once; the extension writes directly there
- **Open Folder Link** — Optional Windows helper link so the extension can open the target folder in Explorer after a successful run
- **Subfolder Prefix** — Optional subfolder inside the granted target folder
- **Auto Mode** — Toggle for hands-free download workflow
- **Open Folder After Download** — Opens the linked OS folder after a clean download
- **Write Repo Marker** — Optional `.gfdl-download.json` file at the downloaded repo root
- **Concurrent Downloads** — 1–6 parallel file downloads
- **Recent Downloads** — Read-only list of the most recent completed download runs

## How It Works

1. Navigate to a GitHub repository
2. Hover over file/folder rows to reveal checkboxes
3. Select folders or files
4. Click the **DOWNLOAD** button on the floating bar
5. If folder access is missing or expired, reauthorize once
6. Files write directly to `<target>/<optional-prefix>/<repo>/...`
7. Completed runs are recorded in extension history and mirrored to a local SQLite DB when the native helper supports it

## Project Structure

```
src/
  manifest.json              # MV3 extension manifest
  background/
    service-worker.js        # Message router, download orchestration
  content/
    main.js                  # Entry point
    github-observer.js       # SPA navigation detection
    checkbox-injector.js     # File row checkbox injection
    overlay-bar.js           # Floating action bar
    progress-modal.js        # Download progress UI
    shadow-host.js           # Shadow DOM encapsulation
  popup/
    popup.html/js/css        # Settings and auth UI
  lib/
    directory-state.js       # Folder access state helpers
    download-plan.js         # Deduplicated manifest builder
    github-api.js            # GitHub Trees API client
    file-writer.js           # File System Access API writer
    auth.js                  # OAuth + PAT authentication
    storage.js               # chrome.storage.local wrapper
    message-bus.js           # Typed messaging
  styles/
    tokens.css               # Design tokens
    components.css           # Reusable components
    content-inject.css       # Shadow DOM styles
scripts/
  build.js                   # esbuild bundler
  generate-icons.js          # PNG icon generator
test/
  unit/                      # Node.js test runner
  cdp/                       # Puppeteer smoke tests
```

## Development

```bash
npm run build          # Bundle to dist/
npm run test:unit      # Run unit tests
npm test               # Run CDP smoke tests (requires headed Chrome)
```

## Direct-Write Contract

- Automated downloads always require a writable folder handle.
- The extension does not silently fall back to browser-managed Downloads.
- Output paths are always rooted at `<target>/<optional-prefix>/<repo>/...`.
- If folder access expires, the next download prompts for reauthorization before any files are written.
- History recording is always on; the optional repo marker file is off by default.
- If Chrome or Windows rejects a target name such as `.env.example`, GFDL retries with a safe underscore-prefixed filename such as `_.env.example`.

## Windows Native Helper

To enable `OPEN FOLDER AFTER DOWNLOAD` and the local SQL history mirror, install the native helper once:

1. Load the unpacked extension from `dist/`.
2. Copy the extension ID from the popup.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-native-host.ps1 -ExtensionId <your-extension-id>
```

4. Reload the extension.
5. In the popup, grant `TARGET FOLDER ACCESS`, then use `LINK` under `OPEN FOLDER LINK` and choose the same folder path for Explorer-open support.
6. If you want the SQL mirror, make sure `sqlite3.exe` is reachable either on PATH or through `GFDL_SQLITE3_PATH`.

## License

MIT
