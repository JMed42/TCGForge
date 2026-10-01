const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initDatabase, registerIpcHandlers } = require('./database');

// Detect dev mode without needing electron-is-dev
const isDev = !app.isPackaged;

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
    mainWindow.webContents.openDevTools();
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
    await initDatabase(app.getPath('userData'));
    registerIpcHandlers(ipcMain);
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
