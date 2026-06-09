/* state.js — Client-side state manager (event emitter pattern)
   Feature: 002-frontend-ux
   Single source of truth for current directory, selection, upload queue */

class AppState {
  constructor() {
    this._listeners = {};
    this._state = {
      currentDirectoryId: null,   // currently viewed directory (null = root)
      selectedNodeId: null,       // selected file/directory
      ownerId: 1,                 // current user ID (hardcoded for v1; replace with auth)
      operatorId: 1,              // for audit log (hardcoded for v1)
      uploadQueue: [],            // pending uploads [{name, progress, status}]
      fileCount: 0,               // total files in current directory
    };

    // Bind event emitter methods
    this.on = this.on.bind(this);
    this.off = this.off.bind(this);
    this.emit = this.emit.bind(this);
  }

  // =========================================================================
  // Event Emitter
  // =========================================================================
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(cb => {
      try { cb(data); } catch (e) {
        console.error('[STATE_EMIT_ERROR]', { event, error: e.message });
      }
    });
  }

  // =========================================================================
  // Getters
  // =========================================================================
  get currentDirectoryId() { return this._state.currentDirectoryId; }
  get selectedNodeId() { return this._state.selectedNodeId; }
  get ownerId() { return this._state.ownerId; }
  get operatorId() { return this._state.operatorId; }
  get uploadQueue() { return this._state.uploadQueue; }

  // =========================================================================
  // Mutations (emit change events for reactive UI updates)
  // =========================================================================
  setCurrentDirectory(dirId, force) {
    console.log('[STATE] setCurrentDirectory(', dirId, ', force=', force, ') current=', this._state.currentDirectoryId);
    if (!force && this._state.currentDirectoryId === dirId) {
      console.log('[STATE] SKIPPED — same directory');
      return;
    }
    this._state.currentDirectoryId = dirId;
    this._state.selectedNodeId = null;  // deselect when changing directory
    this.emit('directory-changed', { directoryId: dirId });
  }

  selectNode(nodeId) {
    if (this._state.selectedNodeId === nodeId) return;
    const prev = this._state.selectedNodeId;
    this._state.selectedNodeId = nodeId;
    this.emit('selection-changed', { nodeId, previousId: prev });
  }

  addToUploadQueue(uploadItem) {
    this._state.uploadQueue.push(uploadItem);
    this.emit('upload-queue-changed', { queue: this._state.uploadQueue });
  }

  updateUploadProgress(index, progress) {
    if (index >= 0 && index < this._state.uploadQueue.length) {
      this._state.uploadQueue[index].progress = progress;
      this.emit('upload-progress', { index, progress });
    }
  }

  removeFromUploadQueue(index) {
    if (index >= 0 && index < this._state.uploadQueue.length) {
      this._state.uploadQueue.splice(index, 1);
      this.emit('upload-queue-changed', { queue: this._state.uploadQueue });
    }
  }

  setFileCount(count) {
    this._state.fileCount = count;
  }

  // Trigger full refresh — tree re-loads, grid re-loads
  refreshAll() {
    this.emit('refresh-all', { directoryId: this._state.currentDirectoryId });
  }
}

// Singleton
window.appState = new AppState();
