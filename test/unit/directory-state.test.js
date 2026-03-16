const { describe, it } = require('node:test');
const assert = require('node:assert');
const { loadSourceModule } = require('./load-source.js');

const { DIRECTORY_ACCESS_STATES, resolveDirectoryAccessState } = loadSourceModule('src/lib/directory-state.js', [
  'DIRECTORY_ACCESS_STATES',
  'resolveDirectoryAccessState'
]);

describe('resolveDirectoryAccessState', () => {
  it('returns missing when no handle exists', () => {
    assert.strictEqual(
      resolveDirectoryAccessState(false, 'granted'),
      DIRECTORY_ACCESS_STATES.MISSING
    );
  });

  it('returns ready when a handle exists and permission is granted', () => {
    assert.strictEqual(
      resolveDirectoryAccessState(true, 'granted'),
      DIRECTORY_ACCESS_STATES.READY
    );
  });

  it('returns expired when a handle exists but permission is not granted', () => {
    assert.strictEqual(
      resolveDirectoryAccessState(true, 'prompt'),
      DIRECTORY_ACCESS_STATES.EXPIRED
    );
  });
});
