/* grid.js — File Grid with sort, delete, trash
   Feature: 002-frontend-ux | Constitution: FR-003, FR-009, FR-011 */

(function() {
  'use strict';

  const gridContainer = document.getElementById('file-grid');
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');
  const uploadBtn = document.getElementById('btn-upload');
  const newFolderBtn = document.getElementById('btn-new-folder');
  const deleteBtn = document.getElementById('btn-delete');
  const trashBtn = document.getElementById('btn-trash');
  const fileInput = document.getElementById('file-input');

  let currentFiles = [];
  let isLoading = false;
  let inTrash = false;
  let abortController = null; // Request deduplication
  let pathCache = {};         // nodeId → full path string

  // ============================================================================
  // Click delegation — single handler on grid container (always active)
  // ============================================================================
  gridContainer.addEventListener('click', function(e) {
    const card = e.target.closest('.file-card');
    if (!card) return;
    const nodeId = parseInt(card.dataset.nodeId);
    const file = currentFiles.find(function(f) { return f.id === nodeId; });
    if (!file) return;

    if (file.type === 'directory' && !inTrash) {
      window.appState.setCurrentDirectory(file.id);
      if (window.selectTreeNode) window.selectTreeNode(file.id);
      return;
    }
    if (inTrash) return;
    // File: show preview
    showPreview(file);
  });

  // ============================================================================
  // Render a single file card
  // ============================================================================
  function renderFileCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.setAttribute('role', 'listitem');
    card.dataset.nodeId = file.id;
    card.dataset.nodeType = file.type;
    card.dataset.hash = file.hash || '';

    if (file.status === 'deleted') card.style.opacity = '0.5';

    // Thumbnail area
    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';

    if (file.type === 'file') {
      const ext = (file.name || '').split('.').pop().toUpperCase();
      const label = document.createElement('span');
      label.className = 'file-type-label';
      label.textContent = ext.length <= 4 ? ext : 'FILE';
      thumb.appendChild(label);
    } else {
      const label = document.createElement('span');
      label.className = 'file-type-label';
      label.textContent = 'DIR';
      thumb.appendChild(label);
    }
    card.appendChild(thumb);

    // File info
    const info = document.createElement('div');
    info.className = 'file-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = window.stripHTML(file.name);
    nameEl.title = window.stripHTML(file.name);
    info.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'file-meta';

    const sizeEl = document.createElement('span');
    sizeEl.textContent = formatFileSize(file.size);
    meta.appendChild(sizeEl);

    const timeEl = document.createElement('span');
    timeEl.textContent = formatRelativeTime(file.modified_at);
    meta.appendChild(timeEl);

    info.appendChild(meta);
    card.appendChild(info);

    if (file.status === 'deleted') {
      card.addEventListener('dblclick', async function() {
        await restoreFile(file, card);
      });
      card.title = '双击恢复';

      // Restore button on card
      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = '恢复';
      restoreBtn.className = 'card-btn card-btn-restore';
      restoreBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        restoreFile(file, card);
      });
      card.appendChild(restoreBtn);
    }

    // Download button on file cards (not in trash, file type only)
    if (!file.status && file.type === 'file') {
      const dlBtn = document.createElement('button');
      dlBtn.textContent = '下载';
      dlBtn.className = 'card-btn';
      dlBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        downloadFile(file);
      });
      card.appendChild(dlBtn);
    }

    // Right-click context menu
    if (!file.status || file.status !== 'deleted') {
      card.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        var menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.cssText = 'position:fixed;z-index:9999;padding:4px 0;min-width:120px;';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        var items = [{label:'下载', action:function(){downloadFile(file);}}, {label:'删除', action:function(){showDeleteConfirm(file);}}];
        items.forEach(function(item) {
          var mi = document.createElement('div');
          mi.textContent = item.label;
          mi.className = 'context-item';
          mi.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:var(--font-size-sm);';
          mi.addEventListener('mouseenter', function() { mi.style.background = 'var(--color-hover)'; });
          mi.addEventListener('mouseleave', function() { mi.style.background = ''; });
          mi.addEventListener('click', function() { item.action(); menu.remove(); });
          menu.appendChild(mi);
        });
        document.body.appendChild(menu);
        setTimeout(function() {
          document.addEventListener('click', function rm() { menu.remove(); }, { once: true });
        }, 0);
      });
      let pressTimer;
      card.addEventListener('touchstart', function() {
        pressTimer = setTimeout(() => showDeleteConfirm(file), 600);
      });
      card.addEventListener('touchend', function() { clearTimeout(pressTimer); });
      card.addEventListener('touchmove', function() { clearTimeout(pressTimer); });
    }

    return card;
  }

  // ============================================================================
  // Delete confirmation
  // ============================================================================
  function showDeleteConfirm(file) {
    if (!confirm('删除「' + window.stripHTML(file.name) + '」？')) return;

    window.dispatchEvent(new CustomEvent('file-delete-triggered', {
      detail: { nodeId: file.id, fileName: file.name }
    }));
  }

  // ============================================================================
  deleteBtn.style.display = 'none';

  // ============================================================================
  // Preview file — opens modal with content
  // ============================================================================
  async function showPreview(file) {
    const modal = document.getElementById('preview-modal');
    const title = document.getElementById('preview-title');
    const body = document.getElementById('preview-body');
    if (!modal || !body) return;

    title.textContent = file.name;
    body.innerHTML = '<div class="skeleton-shimmer" style="height:200px;border-radius:var(--radius-sm);"></div>';
    modal.style.display = 'flex';

    try {
      const data = await window.api.previewFile(file.id);
      if (data.type === 'text') {
        body.innerHTML = '<pre style="font-family:monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;">' + escapeHtml(data.content) + '</pre>';
      } else if (data.type === 'image') {
        body.innerHTML = '<img src="' + data.url + '" style="max-width:100%;max-height:60vh;border-radius:var(--radius-sm);" alt="' + escapeHtml(file.name) + '">';
      } else {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--color-text-muted);"><p style="font-size:48px;margin-bottom:16px;">📄</p><p>' + escapeHtml(file.name) + '</p><p style="font-size:13px;margin-top:8px;">' + formatFileSize(file.size) + ' · ' + (data.ext || '').toUpperCase() + '</p><p style="margin-top:16px;font-size:13px;">不支持预览此文件类型</p></div>';
      }
    } catch (err) {
      body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--color-text-muted);"><p>预览失败</p><p style="font-size:13px;">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================================
  // Download file
  // ============================================================================
  function downloadFile(file) {
    // Fetch with JWT auth header, then trigger blob download
    var token = window.Auth ? window.Auth.getToken() : null;
    fetch(window.API_BASE + '/files/' + file.id + '/download', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    }).then(function(res) {
      if (res.status === 401 || res.status === 403) {
        if (window.Auth) window.Auth.clearSession();
        window.location.href = '/login.html';
        return;
      }
      if (!res.ok) throw new Error('下载失败 (HTTP ' + res.status + ')');
      return res.blob();
    }).then(function(blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }).catch(function(err) {
      console.error('[DOWNLOAD_ERROR]', { fileId: file.id, error: err.message });
      alert('下载失败：' + err.message);
    });
  }

  // ============================================================================
  // Breadcrumb navigation — show current path, click to return to root
  // ============================================================================
  async function renderBreadcrumb(dirId) {
    const bar = document.getElementById('path-bar');
    if (!bar) return;
    bar.innerHTML = '';

    if (dirId == null) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';

    let fullPath = pathCache[dirId];
    if (!fullPath) {
      try {
        const r = await window.api.getFilePath(dirId);
        fullPath = r.path || '/';
        pathCache[dirId] = fullPath;
      } catch (e) {
        fullPath = '/';
      }
    }

    const rootCrumb = document.createElement('span');
    rootCrumb.textContent = '根目录';
    rootCrumb.className = 'breadcrumb-segment';
    rootCrumb.style.cssText = 'cursor:pointer;color:var(--color-accent);';
    rootCrumb.title = '返回根目录';
    rootCrumb.addEventListener('click', () => {
      window.appState.setCurrentDirectory(null, true);
    });
    bar.appendChild(rootCrumb);

    if (fullPath !== '/') {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      sep.style.cssText = 'color:var(--color-text-muted);margin:0 4px;';
      bar.appendChild(sep);

      const pathCrumb = document.createElement('span');
      pathCrumb.textContent = fullPath.replace(/^\//, '');
      pathCrumb.style.cssText = 'font-weight:600;color:var(--color-text-primary);';
      bar.appendChild(pathCrumb);
    }
  }

  // ============================================================================
  // ============================================================================
  // Restore helpers
  // ============================================================================
  async function restoreFile(file, card) {
    try {
      await window.api.restoreNode(file.id);
      if (card) card.remove();
      const idx = currentFiles.indexOf(file);
      if (idx >= 0) currentFiles.splice(idx, 1);
      if (currentFiles.length === 0) renderGrid([]);
      pathCache = {};
      loadDirectory(window.appState.currentDirectoryId);
    } catch (err) {
      alert('恢复失败：' + err.message);
    }
  }

  async function restoreAll() {
    if (!confirm('恢复回收站中所有文件？')) return;
    let errors = 0;
    for (let i = currentFiles.length - 1; i >= 0; i--) {
      try {
        await window.api.restoreNode(currentFiles[i].id);
        currentFiles.splice(i, 1);
      } catch (err) { errors++; }
    }
    renderGrid(currentFiles);
    if (errors > 0) alert(errors + ' 个文件恢复失败');
  }

  async function clearTrash() {
    if (!confirm('确定永久删除回收站中所有文件？此操作不可恢复！')) return;
    try {
      const result = await window.api.clearTrash();
      currentFiles = [];
      renderGrid([]);
    } catch (err) {
      alert('清空失败：' + err.message);
    }
  }

  // ============================================================================
  // Trash / Recycle Bin toggle
  // ============================================================================
  trashBtn.addEventListener('click', async function() {
    inTrash = !inTrash;
    if (inTrash) {
      trashBtn.textContent = '返回';
      trashBtn.classList.add('active');
      deleteBtn.style.display = 'none';
      sortSelect.style.display = 'none';
      newFolderBtn.style.display = 'none';
      uploadBtn.style.display = 'none';
      searchInput.disabled = true;
      searchInput.value = '';
      // Show restore-all button (styled like toolbar buttons)
      let restoreAllBtn = document.getElementById('btn-restore-all');
      if (!restoreAllBtn) {
        restoreAllBtn = document.createElement('button');
        restoreAllBtn.id = 'btn-restore-all';
        restoreAllBtn.textContent = '全部恢复';
        restoreAllBtn.addEventListener('click', restoreAll);
        document.getElementById('grid-toolbar').appendChild(restoreAllBtn);
      }
      restoreAllBtn.style.display = '';
      // Show clear-trash button
      let clearBtn = document.getElementById('btn-clear-trash');
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.id = 'btn-clear-trash';
        clearBtn.textContent = '清空';
        clearBtn.addEventListener('click', clearTrash);
        document.getElementById('grid-toolbar').appendChild(clearBtn);
      }
      clearBtn.style.display = '';
      window.appState.emit('loading-started', { containerId: 'file-grid' });
      try {
        const data = await window.api.getTrash();
        currentFiles = data.items || [];
        renderGrid(currentFiles);
        document.getElementById('tree-title').textContent = '回收站';
        window.appState.emit('loading-complete', { containerId: 'file-grid' });
      } catch (err) {
        renderError();
        window.appState.emit('loading-error', { containerId: 'file-grid' });
      }
    } else {
      trashBtn.textContent = '回收站';
      trashBtn.classList.remove('active');
      deleteBtn.style.display = 'none';
      sortSelect.style.display = '';
      newFolderBtn.style.display = '';
      uploadBtn.style.display = '';
      searchInput.disabled = false;
      const rab = document.getElementById('btn-restore-all');
      if (rab) rab.style.display = 'none';
      const cb = document.getElementById('btn-clear-trash');
      if (cb) cb.style.display = 'none';
      document.getElementById('tree-title').textContent = '目录';
      loadDirectory(window.appState.currentDirectoryId);
    }
  });

  // ============================================================================
  // Sort
  // ============================================================================
  sortSelect.addEventListener('change', function() {
    if (inTrash) return;
    applySort();
    renderGrid(currentFiles);
  });

  function applySort() {
    const sortVal = sortSelect.value;
    const [field, order] = sortVal.split('-');
    const dir = order === 'desc' ? -1 : 1;

    currentFiles.sort(function(a, b) {
      let va, vb;
      if (field === 'name') {
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
        // directories first
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return va < vb ? -dir : va > vb ? dir : 0;
      }
      if (field === 'size') {
        va = a.size || 0;
        vb = b.size || 0;
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return (va - vb) * dir;
      }
      if (field === 'time') {
        va = new Date(a.modified_at || 0).getTime();
        vb = new Date(b.modified_at || 0).getTime();
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return (va - vb) * dir;
      }
      return 0;
    });
  }

  // ============================================================================
  // Load directory contents
  // ============================================================================
  async function loadDirectory(dirId, force) {
    if (!force && (isLoading || inTrash)) {
      return;
    }
    // Cancel previous in-flight request
    if (abortController) abortController.abort();
    abortController = new AbortController();

    isLoading = true;
    renderBreadcrumb(dirId);

    window.appState.emit('loading-started', { containerId: 'file-grid' });

    try {
      const data = await window.api.getFiles(dirId, abortController.signal);
      currentFiles = data.items || [];
      window.appState.setFileCount(data.total || currentFiles.length);
      applySort();
      renderGrid(currentFiles);
      // Refresh this directory's tree children incrementally
      if (dirId != null) {
        window.appState.refreshTreeNode(dirId);
      } else {
        window.appState.emit('tree-refresh-node', { parentDirId: null });
      }
      window.appState.emit('loading-complete', { containerId: 'file-grid', itemCount: currentFiles.length });
    } catch (err) {
      renderError();
      window.appState.emit('loading-error', { containerId: 'file-grid', error: err.message });
    } finally {
      isLoading = false;
    }
  }

  // ============================================================================
  // Render grid
  // ============================================================================
  function renderGrid(files) {
    gridContainer.innerHTML = '';

    if (files.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'empty-state';
      msg.textContent = inTrash ? '回收站为空' : '此目录为空';
      gridContainer.appendChild(msg);
      // deleteBtn hidden
      return;
    }

    files.forEach(function(file, idx) {
      const card = renderFileCard(file);
      card.classList.add('card-enter');
      card.style.setProperty('--card-index', idx);
      gridContainer.appendChild(card);
    });

    if (files.length > 40) {
      gridContainer.style.contentVisibility = '';
      gridContainer.style.containIntrinsicSize = '';
    } else {
      gridContainer.style.contentVisibility = '';
      gridContainer.style.containIntrinsicSize = '';
    }

    // deleteBtn hidden
  }

  // ============================================================================
  // Error
  // ============================================================================
  function renderError() {
    gridContainer.innerHTML = '';
    const div = document.createElement('div');
    div.style.cssText = 'grid-column:1/-1;text-align:center;padding:48px;';
    const p = document.createElement('p');
    p.style.cssText = 'margin-bottom:12px;color:var(--color-text-muted);';
    p.textContent = '加载失败';
    const btn = document.createElement('button');
    btn.textContent = '重试';
    btn.style.cssText = 'padding:8px 16px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);cursor:pointer;';
    btn.addEventListener('click', () => loadDirectory(window.appState.currentDirectoryId));
    div.appendChild(p); div.appendChild(btn);
    gridContainer.appendChild(div);
  }

  // ============================================================================
  // Search
  // ============================================================================
  let searchTimeout;
  searchInput.addEventListener('input', function() {
    if (inTrash) return;
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    searchTimeout = setTimeout(async function() {
      if (!query) { loadDirectory(window.appState.currentDirectoryId); return; }
      window.appState.emit('loading-started', { containerId: 'file-grid' });
      try {
        const data = await window.api.searchFiles(query);
        currentFiles = data.items || []; applySort(); renderGrid(currentFiles);
        window.appState.emit('loading-complete', { containerId: 'file-grid' });
      } catch (err) {
        renderError();
        window.appState.emit('loading-error', { containerId: 'file-grid' });
      }
    }, 300);
  });

  // ============================================================================
  // Upload
  // ============================================================================
  uploadBtn.addEventListener('click', () => fileInput.click());

  // ============================================================================
  // New folder
  // ============================================================================
  newFolderBtn.addEventListener('click', async function() {
    const name = prompt('新建目录名称：');
    if (!name || !name.trim()) return;
    try {
      await window.api.createDirectory(window.stripHTML(name.trim()), window.appState.currentDirectoryId);
      pathCache = {};
      loadDirectory(window.appState.currentDirectoryId);
    } catch (err) { alert('创建失败：' + err.message); }
  });

  // ============================================================================
  // Events
  // ============================================================================
  window.appState.on('directory-changed', (d) => {
    inTrash = false; trashBtn.textContent = '回收站'; trashBtn.classList.remove('active');
    document.getElementById('tree-title').textContent = '目录';
    deleteBtn.style.display = 'none'; sortSelect.style.display = ''; newFolderBtn.style.display = ''; uploadBtn.style.display = '';
    searchInput.disabled = false;
    const rab = document.getElementById('btn-restore-all'); if (rab) rab.style.display = 'none';
    const cb = document.getElementById('btn-clear-trash'); if (cb) cb.style.display = 'none';
    loadDirectory(d.directoryId, true);
  });
  window.appState.on('refresh-all', () => { if (!inTrash) loadDirectory(window.appState.currentDirectoryId); });

  // ============================================================================
  // Init
  // ============================================================================
  document.addEventListener('DOMContentLoaded', () => {
    loadDirectory(null);
    // Preview modal close
    const modal = document.getElementById('preview-modal');
    const closeBtn = document.getElementById('preview-close');
    if (closeBtn) closeBtn.addEventListener('click', function() { modal.style.display = 'none'; });
    if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
  });
})();
