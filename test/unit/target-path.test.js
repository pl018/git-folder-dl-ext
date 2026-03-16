const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadSourceModule } = require('./load-source.js');

const {
  sanitizeDownloadTargetPath,
  sanitizePathSegment,
  isInvalidFilenameError
} = loadSourceModule('src/lib/target-path.js', [
  'sanitizeDownloadTargetPath',
  'sanitizePathSegment',
  'isInvalidFilenameError'
]);

describe('sanitizePathSegment', () => {
  it('prefixes leading-dot filenames with an underscore', () => {
    assert.strictEqual(sanitizePathSegment('.env.example'), '_.env.example');
  });

  it('sanitizes reserved Windows device names', () => {
    assert.strictEqual(sanitizePathSegment('CON'), '_CON');
    assert.strictEqual(sanitizePathSegment('nul.txt'), '_nul.txt');
  });

  it('replaces invalid Windows filename characters', () => {
    assert.strictEqual(sanitizePathSegment('bad:name?.txt'), 'bad_name_.txt');
  });
});

describe('sanitizeDownloadTargetPath', () => {
  it('sanitizes nested hidden files without changing safe segments', () => {
    assert.strictEqual(
      sanitizeDownloadTargetPath('Flowise/docker/.env.example'),
      'Flowise/docker/_.env.example'
    );
  });

  it('sanitizes hidden directories too', () => {
    assert.strictEqual(
      sanitizeDownloadTargetPath('.github/workflows/.env.example'),
      '_.github/workflows/_.env.example'
    );
  });
});

describe('isInvalidFilenameError', () => {
  it('recognizes platform filename errors', () => {
    assert.strictEqual(isInvalidFilenameError(new Error('Invalid filename')), true);
    assert.strictEqual(isInvalidFilenameError(new Error('Name is not allowed')), true);
  });

  it('ignores unrelated errors', () => {
    assert.strictEqual(isInvalidFilenameError(new Error('Network failed')), false);
  });
});
