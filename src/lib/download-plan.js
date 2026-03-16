function normalizePath(value) {
  return (value || '').replace(/^\/+|\/+$/g, '');
}

export function joinPath(...segments) {
  return segments
    .filter(Boolean)
    .map((segment) => normalizePath(segment))
    .filter(Boolean)
    .join('/');
}

export function buildRawUrl(owner, repo, branch, filePath) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

export function buildDownloadPlan({ tree, selections, owner, repo, branch, prefix = '' }) {
  const rootPath = joinPath(prefix, repo);
  const entriesBySource = new Map();

  for (const selection of selections) {
    const selectionType = selection.type || 'tree';
    const selectionPath = normalizePath(selection.path || selection);

    if (selectionType === 'blob') {
      const match = tree.find((item) => item.type === 'blob' && item.path === selectionPath);
      if (match) {
        entriesBySource.set(match.path, createEntry(match.path, owner, repo, branch, rootPath));
      }
      continue;
    }

    const prefixPath = selectionPath ? `${selectionPath}/` : '';
    for (const item of tree) {
      if (item.type !== 'blob') continue;
      if (prefixPath && !item.path.startsWith(prefixPath)) continue;
      entriesBySource.set(item.path, createEntry(item.path, owner, repo, branch, rootPath));
    }
  }

  const entries = Array.from(entriesBySource.values()).sort((left, right) => {
    return left.targetPath.localeCompare(right.targetPath);
  });

  return {
    repo,
    rootPath,
    entries
  };
}

function createEntry(sourcePath, owner, repo, branch, rootPath) {
  return {
    sourcePath,
    targetPath: joinPath(rootPath, sourcePath),
    downloadUrl: buildRawUrl(owner, repo, branch, sourcePath)
  };
}
