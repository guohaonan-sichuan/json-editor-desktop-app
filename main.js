const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;

// Recent files storage
const MAX_RECENT_FILES = 10;
const RECENT_FILES_PATH = path.join(app.getPath('userData'), 'recent-files.json');

// Load recent files from storage
function loadRecentFiles() {
  try {
    if (fs.existsSync(RECENT_FILES_PATH)) {
      const data = fs.readFileSync(RECENT_FILES_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading recent files:', error);
  }
  return [];
}

// Save recent files to storage
function saveRecentFiles(recentFiles) {
  try {
    fs.writeFileSync(RECENT_FILES_PATH, JSON.stringify(recentFiles, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving recent files:', error);
  }
}

// Add a file to recent files list
function addToRecentFiles(filePath) {
  let recentFiles = loadRecentFiles();
  // Remove if already exists
  recentFiles = recentFiles.filter(f => f.path !== filePath);
  // Add to beginning
  recentFiles.unshift({
    path: filePath,
    name: path.basename(filePath),
    timestamp: Date.now()
  });
  // Keep only MAX_RECENT_FILES
  recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
  saveRecentFiles(recentFiles);
  // Update menu
  createMenu();
}

// Remove a file from recent files list
function removeFromRecentFiles(filePath) {
  let recentFiles = loadRecentFiles();
  recentFiles = recentFiles.filter(f => f.path !== filePath);
  saveRecentFiles(recentFiles);
  createMenu();
}

// Get recent files list
function getRecentFiles() {
  return loadRecentFiles();
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      worldSafeExecuteJavaScript: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset', // For a more native macOS look
    backgroundColor: '#f5f5f5',
    // Add icon for the window
    icon: path.join(__dirname, process.platform === 'darwin' ? 'build/icons/icon.icns' : 'build/icons/icon.png')
  });

  // Load the main HTML file
  mainWindow.loadFile('index.html');
  
  // Open DevTools in development mode
//   mainWindow.webContents.openDevTools();

  // Create application menu
  createMenu();

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  const recentFiles = getRecentFiles();
  
  // Build recent files submenu
  const recentFilesSubmenu = [
    {
      label: 'Clear Recent',
      enabled: recentFiles.length > 0,
      click: () => {
        saveRecentFiles([]);
        createMenu();
      }
    },
    { type: 'separator' }
  ];
  
  if (recentFiles.length === 0) {
    recentFilesSubmenu.push({
      label: 'No Recent Files',
      enabled: false
    });
  } else {
    recentFiles.forEach(file => {
      recentFilesSubmenu.push({
        label: `${file.name}  (${file.path})`,
        click: async () => {
          try {
            // Check if file still exists
            if (!fs.existsSync(file.path)) {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'File Not Found',
                message: `The file "${file.name}" could not be found.`,
                detail: `Path: ${file.path}`,
                buttons: ['OK']
              });
              removeFromRecentFiles(file.path);
              return;
            }
            const content = fs.readFileSync(file.path, 'utf8');
            mainWindow.webContents.send('file-opened', { path: file.path, content });
            addToRecentFiles(file.path);
          } catch (error) {
            console.error('Error opening recent file:', error);
            dialog.showErrorBox('Error', `Failed to open file: ${error.message}`);
            removeFromRecentFiles(file.path);
          }
        }
      });
    });
  }
  
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-new')
        },
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'JSON Files', extensions: ['json'] }]
            });
            if (!canceled && filePaths.length > 0) {
              const content = fs.readFileSync(filePaths[0], 'utf8');
              mainWindow.webContents.send('file-opened', { path: filePaths[0], content });
              addToRecentFiles(filePaths[0]);
            }
          }
        },
        {
          label: 'Open Recent',
          submenu: recentFilesSubmenu
        },
        {
          label: 'Import from URL',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow.webContents.send('menu-import-url')
        },
        {
          label: 'Import from Clipboard',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const text = clipboard.readText();
            if (text) {
              mainWindow.webContents.send('import-clipboard', text);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save')
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu-save-as')
        },
        {
          label: 'Export to Clipboard',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow.webContents.send('menu-export-clipboard')
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Format JSON',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow.webContents.send('menu-format')
        },
        {
          label: 'Compress JSON',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => mainWindow.webContents.send('menu-compress')
        },
        {
          label: 'Validate JSON',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => mainWindow.webContents.send('menu-validate')
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('menu-find')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'File Explorer',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('toggle-file-explorer')
        },
        {
          label: 'Toggle Tree View',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('toggle-tree-view')
        },
        {
          label: 'Collapse All',
          accelerator: 'CmdOrCtrl+[',
          click: () => mainWindow.webContents.send('menu-collapse-all')
        },
        {
          label: 'Expand All',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow.webContents.send('menu-expand-all')
        }
      ]
    },
    {
      label: 'Schema',
      submenu: [
        {
          label: 'Load Schema',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'JSON Schema', extensions: ['json'] }]
            });
            if (!canceled && filePaths.length > 0) {
              const content = fs.readFileSync(filePaths[0], 'utf8');
              mainWindow.webContents.send('schema-loaded', { path: filePaths[0], content });
            }
          }
        },
        {
          label: 'Generate Schema from Current JSON',
          click: () => mainWindow.webContents.send('menu-generate-schema')
        },
        {
          label: 'Validate Against Schema',
          click: () => mainWindow.webContents.send('menu-validate-schema')
        },
        {
          label: 'Clear Schema',
          click: () => mainWindow.webContents.send('menu-clear-schema')
        }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://github.com/yourusername/json-editor-app');
          }
        },
        {
          label: 'Keyboard Shortcuts',
          click: () => mainWindow.webContents.send('menu-show-shortcuts')
        }
      ]
    }
  ];

  // macOS specific menu items
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Handle file save as
ipcMain.handle('save-file-as', async (event, content) => {
  try {
    const result = await dialog.showSaveDialog({
      defaultPath: 'untitled.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      addToRecentFiles(result.filePath);
    }
    
    return result; // Return the whole result object which includes filePath and canceled properties
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
});

// Handle file open request
ipcMain.on('open-file', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (!canceled && filePaths.length > 0) {
    const content = fs.readFileSync(filePaths[0], 'utf8');
    event.sender.send('file-opened', { path: filePaths[0], content });
  }
});

// Handle clipboard export
ipcMain.on('export-to-clipboard', (event, content) => {
  clipboard.writeText(content);
  event.reply('export-complete', 'Copied to clipboard');
});

// Handle URL import
ipcMain.handle('import-from-url', async (event, url) => {
  try {
    const content = await fetchUrl(url);
    return content;
  } catch (error) {
    throw new Error(`Failed to import from URL: ${error.message}`);
  }
});

// Fetch URL content
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(new Error(`Status Code: ${response.statusCode}`));
      }
      
      const data = [];
      response.on('data', (chunk) => {
        data.push(chunk);
      });
      
      response.on('end', () => {
        try {
          const content = Buffer.concat(data).toString();
          resolve(content);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    request.on('error', (err) => {
      reject(err);
    });
    
    request.end();
  });
}

// Handle opening a file dialog
ipcMain.handle('open-file-dialog', async () => {
  try {
    return await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
  } catch (error) {
    console.error('Error opening file dialog:', error);
    throw error;
  }
});

// Handle opening a folder dialog
ipcMain.handle('open-folder-dialog', async () => {
  try {
    return await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
  } catch (error) {
    console.error('Error opening folder dialog:', error);
    throw error;
  }
});

// Handle reading a folder's contents
ipcMain.handle('read-folder', async (event, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath);
    const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json'));
    return jsonFiles.map(file => ({
      name: file,
      path: path.join(folderPath, file)
    }));
  } catch (error) {
    console.error('Error reading folder:', error);
    throw error;
  }
});

// Handle reading a file
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

// Handle saving a file
ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    addToRecentFiles(filePath);
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
});

// When Electron is ready
app.whenReady().then(createWindow);

// Quit when all windows are closed, except on macOS where it's typical
// for applications to remain open until the user quits with Cmd + Q
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 