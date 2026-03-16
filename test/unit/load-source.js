const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSourceModule(relativePath, exportedNames) {
  const absPath = path.join(__dirname, '..', '..', relativePath);
  let source = fs.readFileSync(absPath, 'utf8');

  source = source
    .replace(/export function /g, 'function ')
    .replace(/export const /g, 'const ')
    .replace(/export async function /g, 'async function ');

  source += `\nmodule.exports = { ${exportedNames.join(', ')} };`;

  const context = {
    module: { exports: {} },
    exports: {},
    console
  };

  vm.runInNewContext(source, context, { filename: absPath });
  return context.module.exports;
}

module.exports = { loadSourceModule };
