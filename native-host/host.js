const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HISTORY_DIR_NAME = 'GFDL';
const HISTORY_DB_NAME = 'history.sqlite';
const SQLITE_ENV_VARS = ['GFDL_SQLITE3_PATH', 'SQLITE3_PATH'];
const SQLITE_CANDIDATES = [
  'C:\\msys64\\mingw64\\bin\\sqlite3.exe',
  'C:\\mnt\\msys64\\mingw64\\bin\\sqlite3.exe',
  'sqlite3.exe'
];

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
      return { hostVersion: '1.1.0', platform: process.platform };
    case 'pickFolder':
      return { path: pickFolderPath() };
    case 'openFolder':
      openFolder(message.path);
      return { opened: true };
    case 'getHistoryDbStatus':
      return getHistoryDbStatus();
    case 'upsertDownloadRun':
      return upsertDownloadRun(message.record);
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

function getHistoryDbStatus() {
  try {
    const sqlitePath = resolveSqliteCliPath();
    if (!sqlitePath) {
      return {
        available: false,
        dbPath: getHistoryDbPath(),
        error: 'sqlite3.exe not found. Set GFDL_SQLITE3_PATH or install sqlite3.'
      };
    }

    initializeHistorySchema(sqlitePath);
    return {
      available: true,
      dbPath: getHistoryDbPath(),
      sqlitePath
    };
  } catch (error) {
    return {
      available: false,
      dbPath: getHistoryDbPath(),
      error: error.message
    };
  }
}

function upsertDownloadRun(record) {
  if (!record || !record.runId) {
    return {
      mirrored: false,
      available: false,
      error: 'Download run record is required.'
    };
  }

  try {
    const sqlitePath = resolveSqliteCliPath();
    if (!sqlitePath) {
      return {
        mirrored: false,
        available: false,
        dbPath: getHistoryDbPath(),
        error: 'sqlite3.exe not found. Set GFDL_SQLITE3_PATH or install sqlite3.'
      };
    }

    initializeHistorySchema(sqlitePath);
    runSqliteBatch(sqlitePath, buildUpsertStatements(record));

    return {
      mirrored: true,
      available: true,
      dbPath: getHistoryDbPath(),
      sqlitePath
    };
  } catch (error) {
    return {
      mirrored: false,
      available: false,
      dbPath: getHistoryDbPath(),
      error: error.message
    };
  }
}

function resolveSqliteCliPath() {
  for (const variable of SQLITE_ENV_VARS) {
    const candidate = process.env[variable];
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of SQLITE_CANDIDATES) {
    if (candidate === 'sqlite3.exe' || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getHistoryDbPath() {
  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : process.cwd());
  return path.join(localAppData, HISTORY_DIR_NAME, HISTORY_DB_NAME);
}

function ensureHistoryDbDirectory() {
  const dbPath = getHistoryDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

function initializeHistorySchema(sqlitePath) {
  ensureHistoryDbDirectory();
  runSqliteBatch(sqlitePath, [
    'PRAGMA foreign_keys = ON;',
    `CREATE TABLE IF NOT EXISTS download_runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      downloaded_at TEXT NOT NULL,
      finished_at TEXT,
      repo_url TEXT,
      owner TEXT,
      repo TEXT,
      repo_full_name TEXT,
      repo_id TEXT,
      repo_private INTEGER NOT NULL DEFAULT 0,
      repo_visibility TEXT,
      repo_description TEXT,
      branch TEXT,
      default_branch TEXT,
      branch_head_sha TEXT,
      tree_sha TEXT,
      selection_fingerprint TEXT,
      content_fingerprint TEXT,
      selected_items_json TEXT NOT NULL,
      selected_items_summary TEXT,
      resolved_entries_json TEXT NOT NULL,
      resolved_entries_summary_json TEXT NOT NULL,
      logical_root_path TEXT,
      linked_native_root_path TEXT,
      resolved_native_target_path TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL,
      marker_written INTEGER NOT NULL DEFAULT 0,
      marker_path TEXT,
      native_history_db_path TEXT,
      native_mirror_error TEXT,
      last_updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS download_run_entries (
      run_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      blob_sha TEXT,
      size INTEGER,
      PRIMARY KEY (run_id, source_path, target_path),
      FOREIGN KEY (run_id) REFERENCES download_runs(run_id) ON DELETE CASCADE
    );`,
    'CREATE INDEX IF NOT EXISTS idx_download_runs_downloaded_at ON download_runs(downloaded_at DESC);',
    'CREATE INDEX IF NOT EXISTS idx_download_run_entries_run_id ON download_run_entries(run_id);'
  ]);
}

function buildUpsertStatements(record) {
  const now = new Date().toISOString();
  const dbPath = getHistoryDbPath();
  const selectedItemsJson = JSON.stringify(Array.isArray(record.selectedItems) ? record.selectedItems : []);
  const resolvedEntries = Array.isArray(record.resolvedEntries) ? record.resolvedEntries : [];
  const resolvedEntriesJson = JSON.stringify(resolvedEntries);
  const resolvedEntriesSummaryJson = JSON.stringify(record.resolvedEntriesSummary || { totalEntries: 0, totalBytes: 0 });
  const errorsJson = JSON.stringify(Array.isArray(record.errors) ? record.errors : []);

  const runColumns = [
    'run_id',
    'status',
    'mode',
    'downloaded_at',
    'finished_at',
    'repo_url',
    'owner',
    'repo',
    'repo_full_name',
    'repo_id',
    'repo_private',
    'repo_visibility',
    'repo_description',
    'branch',
    'default_branch',
    'branch_head_sha',
    'tree_sha',
    'selection_fingerprint',
    'content_fingerprint',
    'selected_items_json',
    'selected_items_summary',
    'resolved_entries_json',
    'resolved_entries_summary_json',
    'logical_root_path',
    'linked_native_root_path',
    'resolved_native_target_path',
    'error_count',
    'errors_json',
    'marker_written',
    'marker_path',
    'native_history_db_path',
    'native_mirror_error',
    'last_updated_at'
  ];

  const runValues = [
    sqlValue(record.runId),
    sqlValue(record.status),
    sqlValue(record.mode),
    sqlValue(record.downloadedAt),
    sqlValue(record.finishedAt),
    sqlValue(record.repoUrl),
    sqlValue(record.owner),
    sqlValue(record.repo),
    sqlValue(record.repoFullName),
    sqlValue(record.repoId),
    sqlValue(record.repoPrivate),
    sqlValue(record.repoVisibility),
    sqlValue(record.repoDescription),
    sqlValue(record.branch),
    sqlValue(record.defaultBranch),
    sqlValue(record.branchHeadSha),
    sqlValue(record.treeSha),
    sqlValue(record.selectionFingerprint),
    sqlValue(record.contentFingerprint),
    sqlValue(selectedItemsJson),
    sqlValue(record.selectedItemsSummary),
    sqlValue(resolvedEntriesJson),
    sqlValue(resolvedEntriesSummaryJson),
    sqlValue(record.logicalRootPath),
    sqlValue(record.linkedNativeRootPath),
    sqlValue(record.resolvedNativeTargetPath),
    sqlValue(record.errorCount || 0),
    sqlValue(errorsJson),
    sqlValue(!!record.markerWritten),
    sqlValue(record.markerPath),
    sqlValue(dbPath),
    sqlValue(record.nativeMirrorError || ''),
    sqlValue(now)
  ];

  const updateAssignments = runColumns
    .filter((column) => column !== 'run_id')
    .map((column) => `${column} = excluded.${column}`);

  const statements = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN IMMEDIATE;',
    `INSERT INTO download_runs (${runColumns.join(', ')})
     VALUES (${runValues.join(', ')})
     ON CONFLICT(run_id) DO UPDATE SET ${updateAssignments.join(', ')};`,
    `DELETE FROM download_run_entries WHERE run_id = ${sqlValue(record.runId)};`
  ];

  for (const entry of resolvedEntries) {
    statements.push(
      `INSERT INTO download_run_entries (run_id, source_path, target_path, blob_sha, size)
       VALUES (${sqlValue(record.runId)}, ${sqlValue(entry.sourcePath)}, ${sqlValue(entry.targetPath)}, ${sqlValue(entry.blobSha || '')}, ${sqlValue(entry.size)});`
    );
  }

  statements.push('COMMIT;');
  return statements;
}

function runSqliteBatch(sqlitePath, statements) {
  const dbPath = ensureHistoryDbDirectory();
  const result = spawnSync(sqlitePath, [dbPath], {
    encoding: 'utf8',
    input: `${statements.join('\n')}\n`,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'sqlite3 command failed').trim();
    throw new Error(detail);
  }

  return dbPath;
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') {
    return value === '' ? "''" : 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}
