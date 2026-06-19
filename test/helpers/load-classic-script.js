const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

function createContext(initial = {}) {
  return vm.createContext({
    console: {
      log() {},
      warn() {},
      error() {},
    },
    setTimeout,
    clearTimeout,
    ...initial,
  });
}

function loadClassicScript(filePath, contextOrInitial = {}) {
  const context = vm.isContext(contextOrInitial)
    ? contextOrInitial
    : createContext(contextOrInitial);
  const absolutePath = path.resolve(repoRoot, filePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  vm.runInContext(source, context, { filename: filePath });
  return context;
}

module.exports = {
  createContext,
  loadClassicScript,
  repoRoot,
};
