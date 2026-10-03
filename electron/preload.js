const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Projects
  getProjects: () => ipcRenderer.invoke('getProjects'),
  getProject: (id) => ipcRenderer.invoke('getProject', id),
  createProject: (data) => ipcRenderer.invoke('createProject', data),
  updateProject: (id, data) => ipcRenderer.invoke('updateProject', id, data),
  deleteProject: (id) => ipcRenderer.invoke('deleteProject', id),

  // Cards
  getCards: (projectId, filters) => ipcRenderer.invoke('getCards', projectId, filters),
  getCard: (id) => ipcRenderer.invoke('getCard', id),
  createCard: (projectId, data) => ipcRenderer.invoke('createCard', projectId, data),
  updateCard: (id, data) => ipcRenderer.invoke('updateCard', id, data),
  deleteCard: (id) => ipcRenderer.invoke('deleteCard', id),
  bulkDeleteCards: (ids) => ipcRenderer.invoke('bulkDeleteCards', ids),
  duplicateCard: (id) => ipcRenderer.invoke('duplicateCard', id),

  // Documents
  getDocuments: (projectId) => ipcRenderer.invoke('getDocuments', projectId),
  getDocument: (id) => ipcRenderer.invoke('getDocument', id),
  createDocument: (projectId, data) => ipcRenderer.invoke('createDocument', projectId, data),
  updateDocument: (id, data) => ipcRenderer.invoke('updateDocument', id, data),
  deleteDocument: (id) => ipcRenderer.invoke('deleteDocument', id),
  moveDocument: (id, newParentId) => ipcRenderer.invoke('moveDocument', id, newParentId),
  searchDocuments: (projectId, query) => ipcRenderer.invoke('searchDocuments', projectId, query),

  // Import/Export
  exportProject: (projectId) => ipcRenderer.invoke('exportProject', projectId),
  importProject: (jsonData) => ipcRenderer.invoke('importProject', jsonData),
  exportCards: (projectId, format) => ipcRenderer.invoke('exportCards', projectId, format),

  // Card types and fields (the project's data model)
  getCardModel: (projectId) => ipcRenderer.invoke('getCardModel', projectId),
  saveCardField: (projectId, field) => ipcRenderer.invoke('saveCardField', projectId, field),
  renameCardField: (projectId, oldKey, newKey, rewrites) => ipcRenderer.invoke('renameCardField', projectId, oldKey, newKey, rewrites),
  deleteCardField: (projectId, key, options) => ipcRenderer.invoke('deleteCardField', projectId, key, options),
  cardFieldValueCount: (projectId, key) => ipcRenderer.invoke('cardFieldValueCount', projectId, key),
  saveCardType: (projectId, type) => ipcRenderer.invoke('saveCardType', projectId, type),
  deleteCardType: (projectId, typeId, options) => ipcRenderer.invoke('deleteCardType', projectId, typeId, options),
  reorderCardTypes: (projectId, ids) => ipcRenderer.invoke('reorderCardTypes', projectId, ids),
  bulkUpdateCards: (projectId, changes) => ipcRenderer.invoke('bulkUpdateCards', projectId, changes),

  // Clipboard: text for the grid, images for "Paste" art buttons
  readClipboard: () => ipcRenderer.invoke('readClipboard'),
  writeClipboardText: (text) => ipcRenderer.invoke('writeClipboardText', text),
  pasteImageFromClipboard: (projectId, options) => ipcRenderer.invoke('pasteImageFromClipboard', projectId, options),

  // Assets index
  getAssets: (projectId, kind) => ipcRenderer.invoke('getAssets', projectId, kind),
  getMissingArt: (projectId) => ipcRenderer.invoke('getMissingArt', projectId),

  // Fit cache (results of the background fit check)
  getFitCache: (projectId) => ipcRenderer.invoke('getFitCache', projectId),
  saveFitResults: (projectId, rows) => ipcRenderer.invoke('saveFitResults', projectId, rows),
  clearFitCache: (projectId) => ipcRenderer.invoke('clearFitCache', projectId),

  // Card import (CSV / XLSX)
  // Path of a File from an <input type="file"> or a drop (File.path is gone in Electron 32+).
  pathForFile: (file) => webUtils.getPathForFile(file),
  readSpreadsheet: (projectId, options) => ipcRenderer.invoke('readSpreadsheet', projectId, options),
  previewImport: (token, mapping, options) => ipcRenderer.invoke('previewImport', token, mapping, options),
  commitImport: (token, mapping, options) => ipcRenderer.invoke('commitImport', token, mapping, options),

  // Card Designer
  getTemplateRules: (projectId) => ipcRenderer.invoke('getTemplateRules', projectId),
  saveTemplateRules: (projectId, rules) => ipcRenderer.invoke('saveTemplateRules', projectId, rules),
  getTemplates: (projectId) => ipcRenderer.invoke('getTemplates', projectId),
  createTemplate: (projectId, name) => ipcRenderer.invoke('createTemplate', projectId, name),
  saveTemplate: (projectId, template, id) => ipcRenderer.invoke('saveTemplate', projectId, template, id),
  deleteTemplate: (id) => ipcRenderer.invoke('deleteTemplate', id),
  listProjectFonts: (projectId) => ipcRenderer.invoke('listProjectFonts', projectId),
  exportTemplateFile: (templateId, options) => ipcRenderer.invoke('exportTemplateFile', templateId, options),
  readTemplateFile: (projectId, options) => ipcRenderer.invoke('readTemplateFile', projectId, options),
  importTemplateFile: (token) => ipcRenderer.invoke('importTemplateFile', token),
  exportCard: (cardId, templateId, options) => ipcRenderer.invoke('exportCard', cardId, templateId, options),
  exportAllCards: (projectId, templateId, options) => ipcRenderer.invoke('exportAllCards', projectId, templateId, options),
  showInFolder: (target) => ipcRenderer.invoke('showInFolder', target),
  getSheetLayout: (templateId, options) => ipcRenderer.invoke('getSheetLayout', templateId, options),
  exportPrintSheets: (projectId, templateId, options) => ipcRenderer.invoke('exportPrintSheets', projectId, templateId, options),
  chooseCardArt: (projectId) => ipcRenderer.invoke('chooseCardArt', projectId),
  importCardArt: (projectId, sourcePath, options) => ipcRenderer.invoke('importCardArt', projectId, sourcePath, options),
  getImageThumbnail: (projectId, imagePath) => ipcRenderer.invoke('getImageThumbnail', projectId, imagePath),
  // Window close guard (see main.js): register, get asked on close, then confirm.
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app-close-requested', listener);
    ipcRenderer.invoke('closeGuardReady');
    return () => ipcRenderer.removeListener('app-close-requested', listener);
  },
  confirmClose: () => ipcRenderer.invoke('confirmClose'),
  // A file under {userData}/projects/{id}/ changed on disk: { projectId, relPath }.
  onAssetChanged: (callback) => {
    const listener = (_, change) => callback(change);
    ipcRenderer.on('assetChanged', listener);
    return () => ipcRenderer.removeListener('assetChanged', listener);
  },
  // Export render host (#render route in the hidden window; see electron/renderWindow.js).
  onRenderJob: (callback) => {
    const listener = (_, job) => callback(job);
    ipcRenderer.on('render:job', listener);
    return () => ipcRenderer.removeListener('render:job', listener);
  },
  renderHostReady: () => ipcRenderer.invoke('render:hostReady'),
  renderDone: (payload) => ipcRenderer.invoke('render:done', payload),
  onExportProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on('exportProgress', listener);
    return () => ipcRenderer.removeListener('exportProgress', listener);
  },
});
