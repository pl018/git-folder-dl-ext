const { describe, it } = require('node:test');
const assert = require('node:assert');
const { webcrypto } = require('node:crypto');
const { loadSourceModule } = require('./load-source.js');

const {
  createHistoryRunRecord,
  finalizeHistoryRunRecord,
  buildRepoMarkerPath,
  createRepoMarkerPayload,
  deriveResolvedNativeTargetPath,
  deriveRunStatus,
  DOWNLOAD_RUN_MODE,
  DOWNLOAD_RUN_STATUS,
  sortHistoryRuns
} = loadSourceModule(
  'src/lib/history-model.js',
  [
    'createHistoryRunRecord',
    'finalizeHistoryRunRecord',
    'buildRepoMarkerPath',
    'createRepoMarkerPayload',
    'deriveResolvedNativeTargetPath',
    'deriveRunStatus',
    'DOWNLOAD_RUN_MODE',
    'DOWNLOAD_RUN_STATUS',
    'sortHistoryRuns'
  ],
  { crypto: webcrypto }
);

describe('createHistoryRunRecord', () => {
  it('captures repo metadata and fingerprints for a direct-write run', () => {
    const run = createHistoryRunRecord({
      owner: 'octocat',
      repo: 'Hello-World',
      branch: 'main',
      defaultBranch: 'main',
      mode: DOWNLOAD_RUN_MODE.DIRECT_WRITE,
      selectedItems: [{ type: 'tree', path: 'src' }],
      resolvedEntries: [
        { sourcePath: 'src/index.js', targetPath: 'repo/src/index.js', blobSha: 'abc123', size: 42 }
      ],
      logicalRootPath: 'repo',
      linkedNativeRootPath: 'C:\\Downloads',
      repoMetadata: {
        id: 123,
        htmlUrl: 'https://github.com/octocat/Hello-World',
        fullName: 'octocat/Hello-World',
        private: false,
        visibility: 'public'
      },
      branchHeadSha: 'deadbeefcafebabe',
      treeSha: 'feedface'
    });

    assert.strictEqual(run.repoFullName, 'octocat/Hello-World');
    assert.strictEqual(run.repoUrl, 'https://github.com/octocat/Hello-World');
    assert.strictEqual(run.logicalRootPath, 'repo');
    assert.strictEqual(run.resolvedNativeTargetPath, 'C:\\Downloads\\repo');
    assert.strictEqual(run.resolvedEntriesSummary.totalEntries, 1);
    assert.match(run.selectionFingerprint, /^sel_[0-9a-f]{8}$/);
    assert.match(run.contentFingerprint, /^cnt_[0-9a-f]{8}$/);
  });
});

describe('finalizeHistoryRunRecord', () => {
  it('marks partial runs when at least one file failed', () => {
    const run = createHistoryRunRecord({
      owner: 'octocat',
      repo: 'Hello-World',
      mode: DOWNLOAD_RUN_MODE.DIRECT_WRITE,
      selectedItems: [{ type: 'tree', path: 'src' }],
      resolvedEntries: [
        { sourcePath: 'src/index.js', targetPath: 'repo/src/index.js', blobSha: 'abc', size: 10 },
        { sourcePath: 'src/app.js', targetPath: 'repo/src/app.js', blobSha: 'def', size: 11 }
      ]
    });

    const finalized = finalizeHistoryRunRecord(run, {
      errors: ['repo/src/app.js: failed']
    });

    assert.strictEqual(finalized.status, DOWNLOAD_RUN_STATUS.PARTIAL);
    assert.strictEqual(finalized.errorCount, 1);
  });

  it('marks cancelled runs explicitly', () => {
    const run = createHistoryRunRecord({
      owner: 'octocat',
      repo: 'Hello-World',
      mode: DOWNLOAD_RUN_MODE.BROWSER_DOWNLOAD,
      resolvedEntries: []
    });

    const finalized = finalizeHistoryRunRecord(run, {
      status: DOWNLOAD_RUN_STATUS.CANCELLED,
      cancelled: true,
      errors: []
    });

    assert.strictEqual(finalized.status, DOWNLOAD_RUN_STATUS.CANCELLED);
  });
});

describe('history helpers', () => {
  it('derives a native target path only for direct-write mode', () => {
    assert.strictEqual(
      deriveResolvedNativeTargetPath({
        mode: DOWNLOAD_RUN_MODE.DIRECT_WRITE,
        linkedNativeRootPath: 'C:\\Base',
        logicalRootPath: 'prefix/repo'
      }),
      'C:\\Base\\prefix\\repo'
    );

    assert.strictEqual(
      deriveResolvedNativeTargetPath({
        mode: DOWNLOAD_RUN_MODE.BROWSER_DOWNLOAD,
        linkedNativeRootPath: 'C:\\Base',
        logicalRootPath: 'repo'
      }),
      ''
    );
  });

  it('creates a repo marker payload with future reconciliation fields', () => {
    const run = createHistoryRunRecord({
      owner: 'octocat',
      repo: 'Hello-World',
      branch: 'main',
      defaultBranch: 'main',
      mode: DOWNLOAD_RUN_MODE.DIRECT_WRITE,
      selectedItems: [{ type: 'tree', path: 'src' }],
      resolvedEntries: [{ sourcePath: 'src/index.js', targetPath: 'repo/src/index.js', blobSha: 'abc', size: 1 }],
      logicalRootPath: 'repo',
      linkedNativeRootPath: 'C:\\Downloads'
    });

    const payload = createRepoMarkerPayload({
      ...run,
      finishedAt: '2026-03-16T12:00:00.000Z'
    });

    assert.strictEqual(buildRepoMarkerPath('repo'), 'repo/.gfdl-download.json');
    assert.strictEqual(payload.destination.logicalRootPath, 'repo');
    assert.strictEqual(payload.fingerprints.selectionFingerprint, run.selectionFingerprint);
    assert.strictEqual(payload.resolvedEntriesSummary.totalEntries, 1);
  });

  it('sorts most recent runs first', () => {
    const runs = sortHistoryRuns([
      { runId: 'a', downloadedAt: '2026-03-16T10:00:00.000Z' },
      { runId: 'b', downloadedAt: '2026-03-16T12:00:00.000Z' }
    ]);

    assert.deepStrictEqual(runs.map((run) => run.runId), ['b', 'a']);
  });

  it('derives final status values deterministically', () => {
    assert.strictEqual(deriveRunStatus({ cancelled: false, totalCount: 3, errorCount: 0 }), DOWNLOAD_RUN_STATUS.COMPLETED);
    assert.strictEqual(deriveRunStatus({ cancelled: false, totalCount: 3, errorCount: 1 }), DOWNLOAD_RUN_STATUS.PARTIAL);
    assert.strictEqual(deriveRunStatus({ cancelled: false, totalCount: 1, errorCount: 1 }), DOWNLOAD_RUN_STATUS.FAILED);
  });
});
