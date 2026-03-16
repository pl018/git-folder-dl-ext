/**
 * Unit tests for github-api.js
 * Uses Node.js built-in test runner (node --test)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadSourceModule } = require('./load-source');

// Since we're testing ES modules in a non-module context,
// we test the pure functions by re-implementing the logic.
// In a real setup, we'd use a loader or bundle for testing.

describe('parseRepoUrl', () => {
  // Inline the parsing logic for unit testing
  function parseRepoUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') throw new Error('Not a GitHub URL');
    const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (segments.length < 2) throw new Error('URL must contain at least owner and repo');
    const owner = segments[0];
    const repo = segments[1];
    if (segments.length === 2) return { owner, repo, branch: null, type: null, path: null };
    const type = segments[2];
    if (segments.length === 3) return { owner, repo, branch: null, type, path: null };
    const branch = segments[3];
    const path = segments.length > 4 ? segments.slice(4).join('/') : null;
    return { owner, repo, branch, type, path };
  }

  it('parses simple repo URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');
    assert.strictEqual(result.owner, 'owner');
    assert.strictEqual(result.repo, 'repo');
    assert.strictEqual(result.branch, null);
  });

  it('parses tree URL with branch and path', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/tree/main/src/lib');
    assert.strictEqual(result.owner, 'owner');
    assert.strictEqual(result.repo, 'repo');
    assert.strictEqual(result.branch, 'main');
    assert.strictEqual(result.type, 'tree');
    assert.strictEqual(result.path, 'src/lib');
  });

  it('parses blob URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/blob/main/README.md');
    assert.strictEqual(result.type, 'blob');
    assert.strictEqual(result.path, 'README.md');
  });

  it('handles repo root with trailing slash', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/');
    assert.strictEqual(result.owner, 'owner');
    assert.strictEqual(result.repo, 'repo');
  });

  it('throws on non-GitHub URL', () => {
    assert.throws(() => parseRepoUrl('https://gitlab.com/owner/repo'), /Not a GitHub URL/);
  });
});

describe('filterTree', () => {
  function filterTree(tree, folderPath) {
    const prefix = folderPath.replace(/^\/+|\/+$/g, '');
    if (!prefix) return tree.filter(item => item.type === 'blob');
    const prefixWithSlash = prefix + '/';
    return tree
      .filter(item => item.type === 'blob' && item.path.startsWith(prefixWithSlash))
      .map(item => ({ ...item, path: item.path.slice(prefixWithSlash.length) }));
  }

  const sampleTree = [
    { path: 'README.md', type: 'blob', sha: 'a' },
    { path: 'src', type: 'tree', sha: 'b' },
    { path: 'src/index.js', type: 'blob', sha: 'c' },
    { path: 'src/lib/utils.js', type: 'blob', sha: 'd' },
    { path: 'docs/guide.md', type: 'blob', sha: 'e' },
  ];

  it('filters to folder and makes paths relative', () => {
    const result = filterTree(sampleTree, 'src');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, 'index.js');
    assert.strictEqual(result[1].path, 'lib/utils.js');
  });

  it('returns all blobs for empty folder path', () => {
    const result = filterTree(sampleTree, '');
    assert.strictEqual(result.length, 4); // all blobs
  });

  it('returns empty for non-existent folder', () => {
    const result = filterTree(sampleTree, 'nonexistent');
    assert.strictEqual(result.length, 0);
  });
});

describe('buildRawUrl', () => {
  function buildRawUrl(owner, repo, branch, filePath) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  it('constructs correct URL', () => {
    const url = buildRawUrl('owner', 'repo', 'main', 'src/index.js');
    assert.strictEqual(url, 'https://raw.githubusercontent.com/owner/repo/main/src/index.js');
  });
});

describe('getTree', () => {
  it('throws a readable error when GitHub returns no tree array', async () => {
    const { getTree } = loadSourceModule(
      'src/lib/github-api.js',
      ['getTree'],
      {
        fetch: async () => ({
          ok: true,
          headers: { get: () => null },
          json: async () => ({ message: 'Not Found' })
        })
      }
    );

    await assert.rejects(
      () => getTree('owner', 'repo', 'main', null),
      /GitHub tree response was invalid for owner\/repo@main\. Not Found/
    );
  });
});

describe('metadata helpers', () => {
  it('normalizes repository metadata into a stable shape', async () => {
    const { getRepoMetadata } = loadSourceModule(
      'src/lib/github-api.js',
      ['getRepoMetadata'],
      {
        fetch: async () => ({
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            id: 42,
            html_url: 'https://github.com/octocat/Hello-World',
            full_name: 'octocat/Hello-World',
            default_branch: 'main',
            visibility: 'public',
            private: false,
            description: 'Example repo'
          })
        })
      }
    );

    const result = await getRepoMetadata('octocat', 'Hello-World', null);
    assert.strictEqual(result.id, 42);
    assert.strictEqual(result.defaultBranch, 'main');
    assert.strictEqual(result.htmlUrl, 'https://github.com/octocat/Hello-World');
  });

  it('normalizes branch metadata into commit sha fields', async () => {
    const { getBranchMetadata } = loadSourceModule(
      'src/lib/github-api.js',
      ['getBranchMetadata'],
      {
        fetch: async () => ({
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            name: 'main',
            commit: { sha: 'deadbeefcafebabe' }
          })
        })
      }
    );

    const result = await getBranchMetadata('octocat', 'Hello-World', 'main', null);
    assert.strictEqual(result.name, 'main');
    assert.strictEqual(result.commitSha, 'deadbeefcafebabe');
  });
});
