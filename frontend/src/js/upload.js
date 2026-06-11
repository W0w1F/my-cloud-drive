/* upload.js — File Upload with Progress + Hero Reveal trigger
   Feature: 002-frontend-ux | Constitution: FR-009 (Hero Reveal) */

(function() {
  'use strict';

  const API_BASE = window.API_BASE || 'http://localhost:8081/api/v1';
  const fileInput = document.getElementById('file-input');

  if (!fileInput) return;

  // ============================================================================
  // Handle file selection
  // ============================================================================
  fileInput.addEventListener('change', async function() {
    const files = Array.from(fileInput.files);
    if (files.length === 0) return;

    for (const file of files) {
      await uploadFile(file);
    }

    // Reset input for re-selection of same files
    fileInput.value = '';
  });

  // ============================================================================
  // Upload a single file with progress tracking
  // ============================================================================
  async function uploadFile(file) {
    const gridContainer = document.getElementById('file-grid');
    if (!gridContainer) return;

    // Create upload progress card
    const uploadCard = createUploadCard(file.name);
    gridContainer.insertBefore(uploadCard, gridContainer.firstChild);

    const progressBar = uploadCard.querySelector('.upload-progress');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('parent_id', window.appState.currentDirectoryId || '');

    try {
      const xhr = new XMLHttpRequest();

      // Progress tracking
      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          if (progressBar) progressBar.value = pct;
        }
      });

      // Completion
      const result = await new Promise(function(resolve, reject) {
        xhr.open('POST', API_BASE + '/files/upload');
        const token = window.Auth ? window.Auth.getToken() : null;
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(xhr.responseText));
          }
        };
        xhr.onerror = function() { reject(new Error('上传失败')); };
        xhr.send(formData);
      });

      // Instant upload? Hero Reveal!
      if (result.instant_upload) {
        // Wait for progress bar to briefly show completion
        await new Promise(r => setTimeout(r, 200));

        // Replace progress card with real file card, then animate
        const realCard = createRealFileCard(result);
        uploadCard.replaceWith(realCard);

        window.AnimationOrchestrator.heroReveal(realCard);
      } else {
        // Normal upload: just replace with real card
        uploadCard.remove();
      }

      // Refresh grid and tree
      window.appState.refreshAll();

    } catch (err) {
      console.error('[UPLOAD_ERROR]', { fileName: file.name, error: err.message });
      uploadCard.innerHTML = '<p style="padding:12px;color:var(--color-text-muted);text-align:center;">上传失败</p>';
    }
  }

  // ============================================================================
  // Create upload progress card
  // ============================================================================
  function createUploadCard(fileName) {
    const card = document.createElement('div');
    card.className = 'file-card uploading';

    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    thumb.style.display = 'flex';
    thumb.style.flexDirection = 'column';
    thumb.style.alignItems = 'center';
    thumb.style.justifyContent = 'center';
    thumb.style.gap = 'var(--space-8)';

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:12px;color:var(--color-text-secondary);text-align:center;word-break:break-all;';
    nameEl.textContent = window.stripHTML(fileName);

    const progress = document.createElement('progress');
    progress.className = 'upload-progress';
    progress.value = 0;
    progress.max = 100;

    thumb.appendChild(nameEl);
    thumb.appendChild(progress);
    card.appendChild(thumb);

    return card;
  }

  // ============================================================================
  // Create real file card from upload result
  // ============================================================================
  function createRealFileCard(fileData) {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.nodeId = fileData.id;
    card.dataset.nodeType = 'file';
    card.dataset.hash = fileData.hash || '';

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    const label = document.createElement('span');
    label.className = 'file-type-label';
    const ext = fileData.name.split('.').pop().toUpperCase();
    label.textContent = ext.length <= 4 ? ext : 'FILE';
    thumb.appendChild(label);
    card.appendChild(thumb);

    // Info
    const info = document.createElement('div');
    info.className = 'file-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-name';
    nameEl.textContent = window.stripHTML(fileData.name);
    info.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.innerHTML = '<span>' + window.formatFileSize(fileData.size) + '</span><span>刚刚</span>';
    info.appendChild(meta);
    card.appendChild(info);

    return card;
  }
})();
