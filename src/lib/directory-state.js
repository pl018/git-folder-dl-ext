export const DIRECTORY_ACCESS_STATES = {
  READY: 'folder-ready',
  MISSING: 'folder-missing',
  EXPIRED: 'folder-access-expired'
};

export function resolveDirectoryAccessState(hasHandle, permission) {
  if (!hasHandle) {
    return DIRECTORY_ACCESS_STATES.MISSING;
  }

  return permission === 'granted'
    ? DIRECTORY_ACCESS_STATES.READY
    : DIRECTORY_ACCESS_STATES.EXPIRED;
}
