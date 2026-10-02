const { contextBridge, ipcRenderer } = require('electron');

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

  // Card Designer
  getTemplates: (projectId) => ipcRenderer.invoke('getTemplates', projectId),
  createTemplate: (projectId, name) => ipcRenderer.invoke('createTemplate', projectId, name),
  saveTemplate: (projectId, template, id) => ipcRenderer.invoke('saveTemplate', projectId, template, id),
  deleteTemplate: (id) => ipcRenderer.invoke('deleteTemplate', id),
  renderCard: (cardId, templateId, options) => ipcRenderer.invoke('renderCard', cardId, templateId, options),
  exportCard: (cardId, templateId, options) => ipcRenderer.invoke('exportCard', cardId, templateId, options),
  exportAllCards: (projectId, templateId, options) => ipcRenderer.invoke('exportAllCards', projectId, templateId, options),
  showInFolder: (target) => ipcRenderer.invoke('showInFolder', target),
  getSheetLayout: (templateId, options) => ipcRenderer.invoke('getSheetLayout', templateId, options),
  exportPrintSheets: (projectId, templateId, options) => ipcRenderer.invoke('exportPrintSheets', projectId, templateId, options),
  chooseCardArt: (projectId) => ipcRenderer.invoke('chooseCardArt', projectId),
  importCardArt: (projectId, sourcePath) => ipcRenderer.invoke('importCardArt', projectId, sourcePath),
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
  onExportProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on('exportProgress', listener);
    return () => ipcRenderer.removeListener('exportProgress', listener);
  },
});
