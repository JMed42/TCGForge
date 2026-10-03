// Clipboard access for the renderer: text for the Database grid (copy/paste with Excel and
// Sheets), and images for "Paste" art buttons. Reads go through the main process because the
// renderer's clipboard API needs focus and permission prompts.
//
// An image on the clipboard is either bitmap data (copied from a browser, an image editor, the
// Snipping Tool) or a copied image file (Explorer). Both end up as a file in the project, in
// assets/art (card art), assets/images (template frames) or assets/icons (Library symbols).

const fs = require('fs');
const path = require('path');
const art = require('./cardDesigner/art');

// Windows puts copied files on the clipboard as "FileNameW" (UTF-16 path, NUL-terminated).
function copiedFilePath(clipboard) {
  try {
    const formats = clipboard.availableFormats ? clipboard.availableFormats() : [];
    if (process.platform === 'win32' || formats.includes('FileNameW')) {
      const buf = clipboard.readBuffer('FileNameW');
      if (buf && buf.length) {
        const p = buf.toString('utf16le').replace(/\0+$/, '').split('\0')[0];
        if (p && fs.existsSync(p)) return p;
      }
    }
    const uri = clipboard.read ? clipboard.read('public.file-url') : '';
    if (uri && uri.startsWith('file://')) {
      const p = decodeURIComponent(new URL(uri).pathname);
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // no file on the clipboard
  }
  return null;
}

function clipboardImageFile(clipboard) {
  const file = copiedFilePath(clipboard);
  return file && art.ART_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase()) ? file : null;
}

function hasImage(clipboard) {
  const img = clipboard.readImage();
  return (img && !img.isEmpty()) || Boolean(clipboardImageFile(clipboard));
}

/**
 * Save the clipboard's image into the project.
 * @returns {Promise<{ path: string, source: 'image' | 'file' } | { empty: true }>}
 */
async function pasteImage(clipboard, userDataPath, projectId, { folder = 'art', name } = {}) {
  const file = clipboardImageFile(clipboard);
  if (file) return { path: await art.importCardArt(userDataPath, projectId, file, { folder }), source: 'file' };
  const img = clipboard.readImage();
  if (img && !img.isEmpty()) return { path: await art.importImageData(userDataPath, projectId, img.toPNG(), { folder, name }), source: 'image' };
  return { empty: true };
}

function registerClipboardIpc(ipcMain, { clipboard, userDataPath }) {
  ipcMain.handle('readClipboard', () => ({ text: clipboard.readText(), hasImage: hasImage(clipboard) }));
  ipcMain.handle('writeClipboardText', (_, text) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('pasteImageFromClipboard', async (_, projectId, options = {}) => {
    const res = await pasteImage(clipboard, userDataPath, projectId, options);
    if (res.empty) return res;
    const thumbnail = await art.thumbnail(userDataPath, projectId, res.path).catch(() => null);
    return { ...res, thumbnail };
  });
}

module.exports = { registerClipboardIpc, pasteImage, hasImage, copiedFilePath };
