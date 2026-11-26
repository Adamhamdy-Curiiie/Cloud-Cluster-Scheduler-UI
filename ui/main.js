const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain } = require('electron');
const { runJava } = require('./java-runner');
const javaConfig = require('./java-config');

const schedulerJava = app.isPackaged ? javaConfig.packagedJava(process.resourcesPath) : javaConfig;

let mainWindow;
let activeRun;
let modelsDirectory;

ipcMain.handle('scheduler:models', async event => {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame) return [];
  try {
    const entries = await fs.readdir(modelsDirectory, { withFileTypes: true });
    const directoryUrl = path.relative(__dirname, modelsDirectory).split(path.sep).map(encodeURIComponent).join('/');
    return entries.filter(entry => entry.isFile() && /\.(glb|gltf)$/i.test(entry.name))
      .map(entry => directoryUrl + '/' + encodeURIComponent(entry.name)).sort();
  } catch {
    return [];
  }
});

ipcMain.handle('scheduler:run', async (event, input) => {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame) {
    return { error: 'This window cannot run the scheduler.' };
  }
  if (activeRun) return { error: 'A simulation is already running.' };
  activeRun = new AbortController();
  try {
    return await runJava(input, schedulerJava, activeRun.signal);
  } catch (error) {
    return { error: error.message };
  } finally {
    activeRun = undefined;
  }
});

async function createWindow({ show = true, modelDirectory = path.join(__dirname, 'assets', 'models') } = {}) {
  modelsDirectory = modelDirectory;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    show,
    title: 'Cloud Cluster · CPU Scheduling',
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const window = mainWindow;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => {
    activeRun?.abort();
    mainWindow = undefined;
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  return window;
}

if (require.main === module) {
  app.whenReady().then(() => createWindow()).catch(error => {
    console.error(error);
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(error => { console.error(error); app.quit(); });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { createWindow };
