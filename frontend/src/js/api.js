/* api.js — REST API client with error tracking + JWT auth
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
// API Client (with JWT Auth)
// ============================================================================
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const token = window.Auth ? window.Auth.getToken() : null;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...options.headers
    },
    ...options
  };

  try {
    const response = await fetch(url, config);

    if (response.status === 401) {
      console.error('[AUTH_ERROR]', { endpoint, status: 401 });
      if (window.Auth) { window.Auth.clearSession(); }
      window.location.href = '/login.html';
      throw new Error('未授权，请重新登录');
    }

    if (response.status === 403) {
      console.error('[AUTH_ERROR]', { endpoint, status: 403 });
      window.location.href = '/login.html';
      throw new Error('令牌无效，请重新登录');
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody.error?.message || `HTTP ${response.status}`;

      console.error('[API_ERROR]', {
        endpoint: endpoint,
        status: response.status,
        message: errorMsg,
        timestamp: new Date().toISOString()
      });

      throw new Error(errorMsg);
    }

    if (response.headers.get('Content-Type')?.includes('application/octet-stream')) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
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
  getTree(parentId) {
    const params = new URLSearchParams();
    if (parentId) params.set('parent_id', parentId);
    return apiRequest(`/tree?${params}`);
  },

  // File list (grid)
  getFiles(parentId, signal, offset = 0, limit = 50) {
    const params = new URLSearchParams({ offset, limit });
    if (parentId != null) params.set('parent_id', parentId);
    return apiRequest(`/files?${params}`, signal ? { signal } : {});
  },

  // Search
  searchFiles(query) {
    const params = new URLSearchParams({ q: query });
    return apiRequest(`/files/search?${params}`);
  },

  // Upload (multipart — handled separately in upload.js)
  uploadFile(formData) {
    const token = window.Auth ? window.Auth.getToken() : null;
    return fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData
    }).then(r => {
      if (r.status === 401) { if (window.Auth) window.Auth.clearSession(); window.location.href = '/login.html'; throw new Error('未授权'); }
      return r.ok ? r.json() : r.json().then(e => { throw new Error(e.error?.message); });
    });
  },

  // Download
  downloadFile(nodeId) {
    return apiRequest(`/files/${nodeId}/download`);
  },

  // Soft delete
  deleteNode(nodeId) {
    return apiRequest(`/files/${nodeId}/delete`, { method: 'POST' });
  },

  // Restore
  restoreNode(nodeId) {
    return apiRequest(`/files/${nodeId}/restore`, { method: 'POST' });
  },

  // Trash / recycle bin
  getTrash() {
    return apiRequest('/trash');
  },

  clearTrash() {
    return apiRequest('/trash/clear', { method: 'DELETE' });
  },

  // Full path
  getFilePath(nodeId) {
    return apiRequest(`/files/${nodeId}/path`);
  },

  // Preview
  previewFile(nodeId) {
    return apiRequest(`/files/${nodeId}/preview`);
  },

  // Move
  moveNode(nodeId, newParentId) {
    return apiRequest(`/files/${nodeId}/move`, {
      method: 'POST',
      body: JSON.stringify({ new_parent_id: newParentId })
    });
  },

  // Create directory
  createDirectory(name, parentId) {
    return apiRequest('/directories', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId })
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
window.API_BASE = API_BASE;
