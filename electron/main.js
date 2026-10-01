const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { initDatabase, registerIpcHandlers, queryCards, getCard } = require('./database');
const { registerCardDesignerIpc } = require('./cardDesigner/ipc');
const { migrateLegacyData } = require('./legacyData');

// Detect dev mode without needing electron-is-dev
const isDev = !app.isPackaged;

// Same data folder for dev and packaged builds (by default they differ: package name vs
// productName). An explicit --user-data-dir (throwaway dev profiles) still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'TCGForge'));
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // StartTCGForge.cmd sets TCGFORGE_NO_DEVTOOLS for an everyday window; `npm run dev` keeps them.
    if (!process.env.TCGFORGE_NO_DEVTOOLS) mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Entry point: wait for app ready, then init DB (async), then open window
app.whenReady().then(async () => {
  try {
    if (!app.commandLine.hasSwitch('user-data-dir')) {
      const migration = migrateLegacyData(app.getPath('appData'), app.getPath('userData'));
      if (migration.migrated) console.log(`Copied TCG Studio data from ${migration.from}`);
    }
    await initDatabase(app.getPath('userData'));
    registerIpcHandlers(ipcMain);
    registerCardDesignerIpc(ipcMain, {
      userDataPath: app.getPath('userData'),
      getCard,
      queryCards,
      dialog,
      shell,
      getWindow: () => mainWindow,
    });
    createWindow();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
