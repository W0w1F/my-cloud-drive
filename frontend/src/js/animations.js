/* animations.js — Animation Orchestrator
   Feature: 002-frontend-ux | Constitution: FR-009, FR-010, FR-012, FR-013 */

(function() {
  'use strict';

  // ============================================================================
  // Animation Queue — ensures animations don't collide (Constitution FR-013)
  // ============================================================================
  const animationQueue = [];
  let isAnimating = false;

  function enqueue(fn) {
    animationQueue.push(fn);
    if (!isAnimating) processQueue();
  }

  async function processQueue() {
    if (animationQueue.length === 0) {
      isAnimating = false;
      return;
    }
    isAnimating = true;
    const fn = animationQueue.shift();
    await fn();
    processQueue();
  }

  // ============================================================================
  // Hero Reveal (Constitution FR-009)
  // ============================================================================
  function heroReveal(cardElement) {
    return new Promise(function(resolve) {
      cardElement.classList.add('hero-reveal');
      cardElement.addEventListener('animationend', function handler() {
        cardElement.removeEventListener('animationend', handler);
        cardElement.classList.remove('hero-reveal');
        resolve();
      }, { once: true });
    });
  }

  // ============================================================================
  // Damped Slide-Out (Constitution FR-010)
  // ============================================================================
  function dampedSlideOut(cardElement) {
    return new Promise(function(resolve) {
      cardElement.classList.add('damped-slide-out');
      cardElement.addEventListener('animationend', function handler() {
        cardElement.removeEventListener('animationend', handler);
        cardElement.remove();
        resolve();
      }, { once: true });
    });
  }

  // ============================================================================
  // Slide-In Restore (Constitution FR-012 — undo)
  // ============================================================================
  function slideInRestore(cardElement) {
    return new Promise(function(resolve) {
      cardElement.classList.add('slide-in-restore');
      cardElement.addEventListener('animationend', function handler() {
        cardElement.removeEventListener('animationend', handler);
        cardElement.classList.remove('slide-in-restore');
        resolve();
      }, { once: true });
    });
  }

  // ============================================================================
  // Batch Reflow — reposition remaining cards after delete (Constitution FR-013)
  // ============================================================================
  function batchReflow(gridContainer) {
    const cards = Array.from(gridContainer.children).filter(c => !c.classList.contains('damped-slide-out'));
    cards.forEach(function(card) {
      card.classList.add('card-reflow');
      card.addEventListener('transitionend', function handler() {
        card.removeEventListener('transitionend', handler);
        card.classList.remove('card-reflow');
      }, { once: true });
    });
  }

  // ============================================================================
  // Snackbar (Constitution FR-012)
  // ============================================================================
  let snackbarTimer = null;

  function ensureSnackbar() {
    let sb = document.getElementById('snackbar');
    if (!sb) {
      sb = document.createElement('div');
      sb.id = 'snackbar';
      sb.innerHTML = '<span id="snackbar-message"></span><button id="snackbar-undo">撤销</button>';
      document.body.appendChild(sb);

      document.getElementById('snackbar-undo').addEventListener('click', function() {
        clearTimeout(snackbarTimer);
        sb.classList.remove('visible');
        window.dispatchEvent(new CustomEvent('snackbar-undo-clicked'));
      });
    }
    return sb;
  }

  function showSnackbar(message, durationMs = 5000) {
    const sb = ensureSnackbar();
    document.getElementById('snackbar-message').textContent = message;
    sb.classList.add('visible');

    clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(function() {
      sb.classList.remove('visible');
    }, durationMs);
  }

  // ============================================================================
  // Delete flow: API call → animation → Snackbar
  // ============================================================================
  window.addEventListener('file-delete-triggered', async function(e) {
    const { nodeId, fileName } = e.detail;

    const card = document.querySelector(`.file-card[data-node-id="${nodeId}"]`);
    if (!card) return;

    // Call API first — if it fails, don't remove the card
    try {
      await window.api.deleteNode(nodeId);
    } catch (err) {
      console.error('[DELETE_ERROR]', { nodeId, error: err.message });
      showSnackbar('删除失败：' + err.message, 3000);
      return;
    }

    // API succeeded — now animate removal
    const gridContainer = document.getElementById('file-grid');
    await dampedSlideOut(card);
    batchReflow(gridContainer);

    // Refresh grid and tree
    window.appState.refreshAll();

    // Show Snackbar with undo (Constitution: 「」 quotes — FR-017)
    showSnackbar('已删除「' + window.stripHTML(fileName) + '」');
  });

  // ============================================================================
  // Snackbar undo handler
  // ============================================================================
  let lastDeletedNode = null;

  window.addEventListener('file-delete-triggered', function(e) {
    lastDeletedNode = { id: e.detail.nodeId, name: e.detail.fileName };
  });

  window.addEventListener('snackbar-undo-clicked', async function() {
    if (!lastDeletedNode) return;

    try {
      await window.api.restoreNode(lastDeletedNode.id);

      // Re-render grid + tree to include restored file
      window.appState.refreshAll();

      // Slide-in animation on the newly added card (delayed for DOM render)
      setTimeout(function() {
        const restoredCard = document.querySelector(`.file-card[data-node-id="${lastDeletedNode.id}"]`);
        if (restoredCard) slideInRestore(restoredCard);
      }, 100);

      lastDeletedNode = null;
    } catch (err) {
      alert('恢复失败：' + err.message);
    }
  });

  // Expose
  window.AnimationOrchestrator = {
    heroReveal,
    dampedSlideOut,
    slideInRestore,
    batchReflow,
    showSnackbar,
    enqueue
  };
})();
