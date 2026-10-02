const { app, BrowserWindow } = require('electron');

function createWindow() {
  // The first build turned webSecurity off to load local files; this build does not.
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: true
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
