# GitHub Folder Downloader (GFDL)

Chrome extension (Manifest V3) that lets you select and download folders from any GitHub repository as actual file structures — no zipping.

## Features

- **Checkbox selection** on GitHub file browser rows (ghost-on-hover, shift+click range select)
- **Folder downloads** preserving directory structure
- **Two download modes**: File System Access API (any folder) or chrome.downloads (Downloads folder)
- **Auto mode**: download, clear selections, and close progress automatically
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
- **Default Download Path** — Click Browse to pick any folder on your system
- **Subfolder Prefix** — Optional subfolder inside the download path
- **Auto Mode** — Toggle for hands-free download workflow
- **Concurrent Downloads** — 1–6 parallel file downloads

## How It Works

1. Navigate to a GitHub repository
2. Hover over file/folder rows to reveal checkboxes
3. Select folders or files
4. Click the **DOWNLOAD** button on the floating bar
5. Files write directly to your chosen directory

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
    github-api.js            # GitHub Trees API client
    download-manager.js      # chrome.downloads orchestration
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

## License

MIT
