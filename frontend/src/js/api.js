/* api.js — REST API client with error tracking
   Feature: 002-frontend-ux
   Constitution: FR-008 (structured console.error), FR-022 (XSS sanitization) */

const API_BASE = 'http://localhost:8081/api/v1';

// ============================================================================
// XSS Sanitization (Constitution FR-022)
// ============================================================================
function stripHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Global Error Handler (Constitution FR-008)
// ============================================================================
window.onerror = function(message, source, lineno, colno, error) {
  console.error('[UNHANDLED_ERROR]', {
    message: stripHTML(String(message)),
    source: source,
    line: lineno,
    column: colno,
    stack: error ? error.stack : null,
    timestamp: new Date().toISOString()
  });
};

// ============================================================================
// API Client
// ============================================================================
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody.error?.message || `HTTP ${response.status}`;

      // Structured error log (Constitution FR-008)
      console.error('[API_ERROR]', {
        endpoint: endpoint,
        status: response.status,
        message: errorMsg,
        timestamp: new Date().toISOString()
      });

      throw new Error(errorMsg);
    }

    // Blob URL cleanup: if this was a download, schedule revocation
    if (response.headers.get('Content-Type')?.includes('application/octet-stream')) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      // Constitution FR-022: revoke Blob URL after 60s
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { blob, url, filename: response.headers.get('X-Filename') || 'download' };
    }

    return response.json();
  } catch (error) {
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      console.error('[API_ERROR]', {
        endpoint: endpoint,
        status: 0,
        message: 'Network error — server unreachable',
        timestamp: new Date().toISOString()
      });
      throw new Error('网络连接失败');
    }
    throw error;
  }
}

// ============================================================================
// API Methods
// ============================================================================
const api = {
  // Directory tree
  getTree(parentId, ownerId) {
    const params = new URLSearchParams();
    if (parentId) params.set('parent_id', parentId);
    if (ownerId) params.set('owner_id', ownerId);
    return apiRequest(`/tree?${params}`);
  },

  // File list (grid)
  getFiles(parentId, ownerId, offset = 0, limit = 50) {
    var params = new URLSearchParams({ offset, limit });
    if (ownerId) params.set('owner_id', ownerId);
    if (parentId != null) params.set('parent_id', parentId);
    return apiRequest(`/files?${params}`);
  },

  // Search
  searchFiles(query, ownerId) {
    const params = new URLSearchParams({ q: query });
    if (ownerId) params.set('owner_id', ownerId);
    return apiRequest(`/files/search?${params}`);
  },

  // Upload (multipart — handled separately in upload.js)
  uploadFile(formData) {
    return fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      body: formData
    }).then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error?.message); }));
  },

  // Download
  downloadFile(nodeId) {
    return apiRequest(`/files/${nodeId}/download`);
  },

  // Soft delete
  deleteNode(nodeId, operatorId) {
    return apiRequest(`/files/${nodeId}/delete`, {
      method: 'POST',
      body: JSON.stringify({ operator_id: operatorId })
    });
  },

  // Restore
  restoreNode(nodeId, operatorId) {
    return apiRequest(`/files/${nodeId}/restore`, {
      method: 'POST',
      body: JSON.stringify({ operator_id: operatorId })
    });
  },

  // Trash / recycle bin
  getTrash(ownerId) {
    return apiRequest(`/trash?owner_id=${ownerId || 1}`);
  },

  clearTrash(ownerId) {
    return apiRequest('/trash/clear', {
      method: 'DELETE',
      body: JSON.stringify({ owner_id: ownerId || 1 })
    });
  },

  // Full path
  getFilePath(nodeId) {
    return apiRequest(`/files/${nodeId}/path`);
  },

  // Move
  moveNode(nodeId, newParentId, operatorId) {
    return apiRequest(`/files/${nodeId}/move`, {
      method: 'POST',
      body: JSON.stringify({ new_parent_id: newParentId, operator_id: operatorId })
    });
  },

  // Create directory
  createDirectory(name, parentId, ownerId) {
    return apiRequest('/directories', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId, owner_id: ownerId })
    });
  },

  // Rename
  renameNode(nodeId, name) {
    return apiRequest(`/files/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }
};

// Expose for use by other modules (no bundler — global namespace)
window.api = api;
window.stripHTML = stripHTML;
