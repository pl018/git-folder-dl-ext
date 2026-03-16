const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadSourceModule } = require('./load-source.js');

const { buildDownloadPlan, joinPath } = loadSourceModule('src/lib/download-plan.js', [
  'buildDownloadPlan',
  'joinPath'
]);

describe('joinPath', () => {
  it('normalizes separators and removes duplicate slashes', () => {
    assert.strictEqual(joinPath('/downloads/', '/repo/', 'src/index.js'), 'downloads/repo/src/index.js');
  });
});

describe('buildDownloadPlan', () => {
  const tree = [
    { path: 'README.md', type: 'blob' },
    { path: 'src/index.js', type: 'blob' },
    { path: 'src/lib/utils.js', type: 'blob' },
    { path: 'docs/guide.md', type: 'blob' },
    { path: 'docs', type: 'tree' }
  ];

  it('builds a repo-rooted target path for a single file', () => {
    const plan = buildDownloadPlan({
      tree,
      selections: [{ type: 'blob', path: 'README.md' }],
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      prefix: ''
    });

    assert.strictEqual(plan.rootPath, 'repo');
    assert.strictEqual(plan.entries.length, 1);
    assert.strictEqual(plan.entries[0].sourcePath, 'README.md');
    assert.strictEqual(plan.entries[0].targetPath, 'repo/README.md');
  });

  it('preserves repository-relative structure for folder selections', () => {
    const plan = buildDownloadPlan({
      tree,
      selections: [{ type: 'tree', path: 'src' }],
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      prefix: 'batch'
    });

    assert.strictEqual(plan.rootPath, 'batch/repo');
    assert.deepStrictEqual(
      plan.entries.map((entry) => entry.targetPath),
      ['batch/repo/src/index.js', 'batch/repo/src/lib/utils.js']
    );
  });

  it('deduplicates overlapping folder and nested file selections', () => {
    const plan = buildDownloadPlan({
      tree,
      selections: [
        { type: 'tree', path: 'src' },
        { type: 'blob', path: 'src/index.js' }
      ],
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      prefix: ''
    });

    assert.strictEqual(plan.entries.length, 2);
    assert.deepStrictEqual(
      plan.entries.map((entry) => entry.sourcePath),
      ['src/index.js', 'src/lib/utils.js']
    );
  });

  it('supports repository-root folder selections', () => {
    const plan = buildDownloadPlan({
      tree,
      selections: [{ type: 'tree', path: '' }],
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      prefix: ''
    });

    assert.strictEqual(plan.entries.length, 4);
    assert.strictEqual(plan.entries[0].targetPath, 'repo/docs/guide.md');
  });

  it('allows browser-mode callers to root downloads at the repo by passing an empty prefix', () => {
    const plan = buildDownloadPlan({
      tree,
      selections: [{ type: 'tree', path: 'src' }],
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      prefix: ''
    });

    assert.strictEqual(plan.rootPath, 'repo');
    assert.deepStrictEqual(
      plan.entries.map((entry) => entry.targetPath),
      ['repo/src/index.js', 'repo/src/lib/utils.js']
    );
  });
});
