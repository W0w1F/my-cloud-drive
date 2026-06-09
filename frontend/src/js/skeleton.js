/* skeleton.js — Skeleton State Manager
   Feature: 002-frontend-ux | Constitution: FR-004, FR-005, FR-006
   Honest placeholders: 300ms min display, shimmer, NO fake content */

(function() {
  'use strict';

  const MIN_DISPLAY_MS = 300;  // Constitution FR-006
  const activeSkeletons = new Map(); // containerId → { startTime, element }

  // ============================================================================
  // Show skeleton in container
  // Constitution FR-005: Honest placeholders — only gray rectangles, NO text
  // ============================================================================
  function showSkeleton(containerId, type, count = 12) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear existing content
    container.innerHTML = '';

    const startTime = Date.now();

    if (type === 'grid') {
      // Match grid layout: grid-template-columns repeat(auto-fill, minmax(180px, 1fr))
      container.style.display = 'grid';
      container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
      container.style.gap = '16px';

      for (let i = 0; i < count; i++) {
        const card = createSkeletonCard();
        container.appendChild(card);
      }
    } else if (type === 'tree') {
      // Match tree layout
      container.style.display = 'block';
      for (let i = 0; i < 6; i++) {
        const row = createSkeletonTreeRow(i);
        container.appendChild(row);
      }
    }

    activeSkeletons.set(containerId, { startTime, element: container });
  }

  // ============================================================================
  // Skeleton card (matches .file-card structure)
  // ============================================================================
  function createSkeletonCard() {
    const card = document.createElement('div');
    card.className = 'skeleton-card';

    const thumb = document.createElement('div');
    thumb.className = 'skeleton-thumb skeleton-shimmer';
    card.appendChild(thumb);

    const line1 = document.createElement('div');
    line1.className = 'skeleton-line skeleton-shimmer';
    card.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'skeleton-line short skeleton-shimmer';
    card.appendChild(line2);

    return card;
  }

  // ============================================================================
  // Skeleton tree row (matches .tree-node structure)
  // ============================================================================
  function createSkeletonTreeRow(depth) {
    const row = document.createElement('div');
    row.className = 'skeleton-tree-row';

    const indent = document.createElement('span');
    indent.className = 'skeleton-indent';
    indent.style.width = (depth * 20) + 'px';
    row.appendChild(indent);

    const line = document.createElement('div');
    line.className = 'skeleton-line skeleton-shimmer';
    row.appendChild(line);

    return row;
  }

  // ============================================================================
  // Transition skeleton to real content
  // Constitution FR-006: minimum 300ms display before transition
  // ============================================================================
  function transitionToContent(containerId, renderCallback) {
    const skeleton = activeSkeletons.get(containerId);
    if (!skeleton) {
      renderCallback();
      return;
    }

    const elapsedMs = Date.now() - skeleton.startTime;
    const remainingMs = Math.max(0, MIN_DISPLAY_MS - elapsedMs);

    setTimeout(function() {
      const container = document.getElementById(containerId);
      if (!container) return;

      // Clear skeleton
      container.innerHTML = '';
      container.style.display = '';
      container.style.gridTemplateColumns = '';
      container.style.gap = '';

      // Render real content
      renderCallback();

      // Fade in
      Array.from(container.children).forEach(el => {
        el.classList.add('skeleton-fade-in');
      });

      activeSkeletons.delete(containerId);
    }, remainingMs);
  }

  // ============================================================================
  // Error state — replace skeleton with error UI
  // ============================================================================
  function showError(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.style.display = 'block';

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'text-align:center;padding:48px;';

    const msg = document.createElement('p');
    msg.textContent = '加载失败';
    msg.style.cssText = 'margin-bottom:12px;color:var(--color-text-muted);';

    const retryBtn = document.createElement('button');
    retryBtn.textContent = '重试';
    retryBtn.style.cssText = 'padding:8px 16px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);cursor:pointer;';
    retryBtn.addEventListener('click', function() {
      window.appState.emit('retry-loading', { containerId });
    });

    errorDiv.appendChild(msg);
    errorDiv.appendChild(retryBtn);
    container.appendChild(errorDiv);

    activeSkeletons.delete(containerId);
  }

  // ============================================================================
  // Listen for loading events from appState
  // ============================================================================
  window.appState.on('loading-started', function(data) {
    showSkeleton(data.containerId, data.containerId === 'file-grid' ? 'grid' : 'tree');
  });

  window.appState.on('loading-complete', function(data) {
    // Grid.js already called renderGrid — just clean up skeleton tracking
    const skeleton = activeSkeletons.get(data.containerId);
    if (skeleton) {
      const elapsedMs = Date.now() - skeleton.startTime;
      const remainingMs = Math.max(0, MIN_DISPLAY_MS - elapsedMs);

      setTimeout(function() {
        activeSkeletons.delete(data.containerId);
      }, remainingMs);
    }
  });

  window.appState.on('loading-error', function(data) {
    showError(data.containerId);
  });

  // Expose
  window.SkeletonManager = { showSkeleton, transitionToContent, showError };
})();
