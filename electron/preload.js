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
});
