const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const INVALID_WINDOWS_TRAILING = /[. ]+$/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_FILENAME_PATTERNS = [
  /invalid filename/i,
  /invalid file name/i,
  /name is not allowed/i,
  /filename is not allowed/i,
  /path is not allowed/i
];

export function sanitizeDownloadTargetPath(targetPath) {
  return String(targetPath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitizePathSegment(segment))
    .join('/');
}

export function sanitizePathSegment(segment) {
  let value = String(segment || '');

  if (!value) {
    return '_';
  }

  if (value === '.') {
    return '_';
  }

  if (value === '..') {
    return '__';
  }

  value = value.replace(INVALID_WINDOWS_CHARS, '_');

  if (value.startsWith('.')) {
    value = `_${value}`;
  }

  value = value.replace(INVALID_WINDOWS_TRAILING, (match) => '_'.repeat(match.length));

  if (!value) {
    value = '_';
  }

  if (RESERVED_WINDOWS_NAME.test(value)) {
    value = `_${value}`;
  }

  return value;
}

export function isInvalidFilenameError(error) {
  const message = String(error?.message || error || '');
  return INVALID_FILENAME_PATTERNS.some((pattern) => pattern.test(message));
}
