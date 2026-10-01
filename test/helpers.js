// Shared test helpers: throwaway user-data folders and an in-process stand-in for ipcMain.

const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tcgforge-${label}-`));
}

function fakeIpc() {
  const handlers = {};
  return {
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    // async like the real ipcMain.handle: a synchronous throw becomes a rejected promise
    call: async (name, ...args) => handlers[name]({ sender: { isDestroyed: () => true, send() {} } }, ...args),
  };
}

module.exports = { tempDir, fakeIpc };
