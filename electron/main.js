const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('path');
const database = require('./database');
const { initDatabase, registerIpcHandlers } = database;
const { registerCardDesignerIpc } = require('./cardDesigner/ipc');
const { registerImportIpc } = require('./import/ipc');
const { migrateLegacyData } = require('./legacyData');
const assets = require('./assets');
const { registerAssetIndexIpc } = require('./assetIndex');
const { registerClipboardIpc } = require('./clipboard');
const { RenderService } = require('./renderWindow');

// tcg-asset:// must be declared privileged before the app is ready.
assets.registerAssetScheme(protocol);

// Detect dev mode without needing electron-is-dev
const isDev = !app.isPackaged;

// Same data folder for dev and packaged builds (by default they differ: package name vs
// productName). An explicit --user-data-dir (throwaway dev profiles) still wins.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'TCGForge'));
}

let mainWindow;
let render = null;
let closeGuard = { ready: false, allowClose: false };

ipcMain.handle('closeGuardReady', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) closeGuard.ready = true;
});
ipcMain.handle('confirmClose', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  closeGuard.allowClose = true;
  mainWindow.close();
});

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

  // Unsaved-changes guard: once the renderer has registered its listener, closing the window
  // asks it first (it may show Save / Discard / Cancel) and it calls confirmClose to proceed.
  // Before that, or if the renderer is gone, the window closes normally.
  closeGuard = { ready: false, allowClose: false };
  mainWindow.on('close', (e) => {
    if (!closeGuard.ready || closeGuard.allowClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app-close-requested');
  });
  mainWindow.webContents.on('render-process-gone', () => { closeGuard.ready = false; });
  mainWindow.webContents.on('did-start-navigation', (_, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) closeGuard.ready = false; // reloads re-register
  });

  mainWindow.on('closed', () => {
    // The hidden export window must not keep the app alive.
    if (render) render.close();
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
    assets.registerAssetProtocol(protocol, net, app.getPath('userData'));
    const assetIndex = registerAssetIndexIpc(ipcMain, { userDataPath: app.getPath('userData'), db: database });
    assets.watchProjectAssets(app.getPath('userData'), (change) => {
      assetIndex.fileChanged(change);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('assetChanged', change);
      }
    });
    registerIpcHandlers(ipcMain);
    // Exports render in a hidden window on the app's #render route (same CardRender as the editor).
    render = new RenderService({
      preload: path.join(__dirname, 'preload.js'),
      load: (win) => (isDev
        ? win.loadURL('http://localhost:5173/#render')
        : win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'render' })),
    });
    registerCardDesignerIpc(ipcMain, {
      userDataPath: app.getPath('userData'),
      getCard: database.getCard,
      queryCards: database.queryCards,
      listTemplates: database.listTemplates,
      getTemplate: database.getTemplate,
      insertTemplate: database.insertTemplate,
      updateTemplate: database.updateTemplate,
      deleteTemplate: database.deleteTemplate,
      listTemplateRules: database.listTemplateRules,
      dialog,
      shell,
      getWindow: () => mainWindow,
      render,
    });
    registerClipboardIpc(ipcMain, { clipboard, userDataPath: app.getPath('userData') });
    registerImportIpc(ipcMain, {
      queryCards: database.queryCards,
      getProject: database.getProject,
      importCards: database.importCards,
      dialog,
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
