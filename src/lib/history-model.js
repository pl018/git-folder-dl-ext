export const DOWNLOAD_RUN_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const DOWNLOAD_RUN_MODE = {
  DIRECT_WRITE: 'direct-write',
  BROWSER_DOWNLOAD: 'browser-download'
};

export const REPO_MARKER_FILE = '.gfdl-download.json';

export function buildRepoUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}`;
}

export function normalizeSelectedItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (typeof item === 'string') {
        return {
          path: normalizeLogicalPath(item),
          type: 'tree'
        };
      }

      return {
        path: normalizeLogicalPath(item?.path || ''),
        type: item?.type === 'blob' ? 'blob' : 'tree'
      };
    })
    .sort((left, right) => {
      const typeCompare = left.type.localeCompare(right.type);
      return typeCompare !== 0 ? typeCompare : left.path.localeCompare(right.path);
    });
}

export function normalizeResolvedEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      sourcePath: normalizeLogicalPath(entry?.sourcePath || ''),
      targetPath: normalizeLogicalPath(entry?.targetPath || ''),
      blobSha: entry?.blobSha || '',
      size: Number.isFinite(entry?.size) ? entry.size : null
    }))
    .sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

export function createHistoryRunRecord({
  runId,
  owner,
  repo,
  branch = '',
  defaultBranch = '',
  mode = DOWNLOAD_RUN_MODE.DIRECT_WRITE,
  selectedItems = [],
  resolvedEntries = [],
  logicalRootPath = '',
  linkedNativeRootPath = '',
  repoMetadata = {},
  branchHeadSha = '',
  treeSha = '',
  downloadedAt = new Date().toISOString(),
  status = DOWNLOAD_RUN_STATUS.PENDING
}) {
  const normalizedSelections = normalizeSelectedItems(selectedItems);
  const normalizedEntries = normalizeResolvedEntries(resolvedEntries);

  return {
    runId: runId || createRunId(),
    status,
    mode,
    downloadedAt,
    finishedAt: null,
    repoUrl: repoMetadata.htmlUrl || buildRepoUrl(owner, repo),
    owner,
    repo,
    repoFullName: repoMetadata.fullName || `${owner}/${repo}`,
    repoId: repoMetadata.id || null,
    repoPrivate: !!repoMetadata.private,
    repoVisibility: repoMetadata.visibility || '',
    repoDescription: repoMetadata.description || '',
    branch: branch || defaultBranch || '',
    defaultBranch: defaultBranch || '',
    branchHeadSha: branchHeadSha || '',
    treeSha: treeSha || '',
    selectionFingerprint: buildSelectionFingerprint(normalizedSelections),
    contentFingerprint: buildContentFingerprint(normalizedEntries),
    selectedItems: normalizedSelections,
    selectedItemsSummary: buildSelectedItemsSummary(normalizedSelections),
    resolvedEntries: normalizedEntries,
    resolvedEntriesSummary: buildResolvedEntriesSummary(normalizedEntries),
    logicalRootPath: normalizeLogicalPath(logicalRootPath),
    linkedNativeRootPath: linkedNativeRootPath || '',
    resolvedNativeTargetPath: deriveResolvedNativeTargetPath({
      mode,
      linkedNativeRootPath,
      logicalRootPath
    }),
    errorCount: 0,
    errors: [],
    markerWritten: false,
    markerPath: '',
    mirroredToSql: false,
    nativeHistoryDbPath: '',
    nativeMirrorError: ''
  };
}

export function finalizeHistoryRunRecord(run, updates = {}) {
  const errors = sanitizeErrors(updates.errors || run.errors || []);
  const status = updates.status || deriveRunStatus({
    cancelled: !!updates.cancelled,
    totalCount: run?.resolvedEntriesSummary?.totalEntries || 0,
    errorCount: errors.length
  });

  return {
    ...run,
    status,
    finishedAt: updates.finishedAt || new Date().toISOString(),
    errorCount: errors.length,
    errors,
    markerWritten: !!updates.markerWritten,
    markerPath: updates.markerPath || '',
    mirroredToSql: !!updates.mirroredToSql,
    nativeHistoryDbPath: updates.nativeHistoryDbPath || '',
    nativeMirrorError: updates.nativeMirrorError || ''
  };
}

export function deriveRunStatus({ cancelled = false, totalCount = 0, errorCount = 0 }) {
  if (cancelled) {
    return DOWNLOAD_RUN_STATUS.CANCELLED;
  }

  if (errorCount === 0) {
    return DOWNLOAD_RUN_STATUS.COMPLETED;
  }

  if (totalCount > errorCount) {
    return DOWNLOAD_RUN_STATUS.PARTIAL;
  }

  return DOWNLOAD_RUN_STATUS.FAILED;
}

export function buildSelectionFingerprint(items) {
  return `sel_${fnv1aHash(JSON.stringify(normalizeSelectedItems(items)))}`;
}

export function buildContentFingerprint(entries) {
  return `cnt_${fnv1aHash(JSON.stringify(normalizeResolvedEntries(entries)))}`;
}

export function buildSelectedItemsSummary(items) {
  const normalized = normalizeSelectedItems(items);

  if (normalized.length === 0) {
    return 'No selections';
  }

  const preview = normalized.slice(0, 2).map((item) => {
    const label = item.path || '/';
    return item.type === 'blob' ? `${label} (file)` : `${label} (folder)`;
  });

  if (normalized.length === 1) {
    return preview[0];
  }

  const suffix = normalized.length > 2 ? ` +${normalized.length - 2} more` : '';
  return `${preview.join(', ')}${suffix}`;
}

export function buildResolvedEntriesSummary(entries) {
  const normalized = normalizeResolvedEntries(entries);

  return {
    totalEntries: normalized.length,
    totalBytes: normalized.reduce((sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0), 0)
  };
}

export function deriveResolvedNativeTargetPath({ mode, linkedNativeRootPath = '', logicalRootPath = '' }) {
  if (mode !== DOWNLOAD_RUN_MODE.DIRECT_WRITE || !linkedNativeRootPath || !logicalRootPath) {
    return '';
  }

  const cleanedRoot = linkedNativeRootPath.replace(/[\\/]+$/, '');
  const relative = normalizeLogicalPath(logicalRootPath).replace(/\//g, '\\');
  return relative ? `${cleanedRoot}\\${relative}` : cleanedRoot;
}

export function buildRepoMarkerPath(logicalRootPath) {
  return joinLogicalPath(logicalRootPath, REPO_MARKER_FILE);
}

export function createRepoMarkerPayload(run) {
  return {
    schemaVersion: 1,
    runId: run?.runId || '',
    downloadedAt: run?.downloadedAt || '',
    finishedAt: run?.finishedAt || '',
    repo: {
      url: run?.repoUrl || '',
      owner: run?.owner || '',
      repo: run?.repo || '',
      branch: run?.branch || '',
      defaultBranch: run?.defaultBranch || '',
      branchHeadSha: run?.branchHeadSha || '',
      treeSha: run?.treeSha || '',
      repoId: run?.repoId || null,
      visibility: run?.repoVisibility || '',
      private: !!run?.repoPrivate
    },
    destination: {
      logicalRootPath: run?.logicalRootPath || '',
      linkedNativeRootPath: run?.linkedNativeRootPath || '',
      resolvedNativeTargetPath: run?.resolvedNativeTargetPath || ''
    },
    selections: run?.selectedItems || [],
    selectedItemsSummary: run?.selectedItemsSummary || '',
    resolvedEntriesSummary: run?.resolvedEntriesSummary || { totalEntries: 0, totalBytes: 0 },
    fingerprints: {
      selectionFingerprint: run?.selectionFingerprint || '',
      contentFingerprint: run?.contentFingerprint || ''
    }
  };
}

export function summarizeRunDestination(run) {
  return run?.resolvedNativeTargetPath || run?.logicalRootPath || 'Unknown target';
}

export function sortHistoryRuns(runs) {
  return [...(Array.isArray(runs) ? runs : [])].sort((left, right) => {
    const leftValue = Date.parse(left?.downloadedAt || '') || 0;
    const rightValue = Date.parse(right?.downloadedAt || '') || 0;
    return rightValue - leftValue;
  });
}

export function createRunId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function normalizeLogicalPath(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

export function joinLogicalPath(...segments) {
  return segments
    .map((segment) => normalizeLogicalPath(segment))
    .filter(Boolean)
    .join('/');
}

export function sanitizeErrors(errors) {
  return (Array.isArray(errors) ? errors : [])
    .map((error) => String(error || '').trim())
    .filter(Boolean);
}

function fnv1aHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
