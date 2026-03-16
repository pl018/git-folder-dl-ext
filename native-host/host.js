const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function sendMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

function sendError(error) {
  sendMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

let pending = Buffer.alloc(0);
process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    pending = Buffer.concat([pending, chunk]);
    processBuffer();
  }
});

process.stdin.on('end', () => process.exit(0));

function processBuffer() {
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) return;

    const body = pending.slice(4, 4 + length).toString('utf8');
    pending = pending.slice(4 + length);

    try {
      const message = JSON.parse(body);
      Promise.resolve(handleMessage(message))
        .then((result) => sendMessage({ ok: true, ...result }))
        .catch(sendError);
    } catch (error) {
      sendError(error);
    }
  }
}

async function handleMessage(message) {
  switch (message?.action) {
    case 'ping':
      return { hostVersion: '1.0.0', platform: process.platform };
    case 'pickFolder':
      return { path: pickFolderPath() };
    case 'openFolder':
      openFolder(message.path);
      return { opened: true };
    default:
      throw new Error(`Unsupported action: ${message?.action || 'unknown'}`);
  }
}

function pickFolderPath() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "Select the folder to open after downloads"',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($dialog.SelectedPath)',
    '}'
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    encoding: 'utf8'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || 'Folder picker failed').trim());
  }

  return (result.stdout || '').trim();
}

function openFolder(targetPath) {
  if (!targetPath) throw new Error('Folder path is required.');
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Folder does not exist: ${targetPath}`);
  }

  const normalized = path.resolve(targetPath);
  const child = spawn('explorer.exe', [normalized], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}
