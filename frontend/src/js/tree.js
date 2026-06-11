/* tree.js — Directory Tree Component
   Feature: 002-frontend-ux | Constitution: FR-002, FR-006 */

(function() {
  'use strict';

  const treeContainer = document.getElementById('directory-tree');

  // ============================================================================
  // Render a single tree node
  // Constitution FR-002: NO icons, NO color tags, indent-only hierarchy
  // ============================================================================
  function renderNode(node, depth) {
    const hasChildren = node.has_children || node.child_count > 0;
    const indent = depth * 20;  // Constitution FR-002: 20px per level

    const li = document.createElement('li');
    li.className = 'tree-node';
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-expanded', 'false');
    li.dataset.nodeId = node.id;
    li.dataset.nodeType = node.type;
    li.style.paddingLeft = '0';

    // Indent spacer
    const indentSpan = document.createElement('span');
    indentSpan.className = 'tree-indent';
    indentSpan.style.width = indent + 'px';
    li.appendChild(indentSpan);

    // Expand/collapse arrow — directories only; files have no arrow
    const arrow = document.createElement('span');
    if (node.type === 'file') {
      arrow.className = 'tree-arrow empty';
      arrow.textContent = '';
      li.style.opacity = '0.6';
      li.title = '点击跳转到所在目录';
    } else {
      arrow.className = 'tree-arrow' + (hasChildren ? '' : ' empty');
      arrow.textContent = '▶';
    }
    li.appendChild(arrow);

    // Node name — serif display, NO icon
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-node-name';
    nameSpan.textContent = window.stripHTML(node.name);
    li.appendChild(nameSpan);

    // Click handler
    li.addEventListener('click', function(e) {
      e.stopPropagation();

      if (node.type === 'directory') {
        if (e.target === arrow || e.target.closest('.tree-arrow')) {
          toggleExpand(li, node);
        } else {
          navigateToDirectory(li, node);
        }
      } else {
        // File node: click → navigate to parent directory
        const pid = node.parent_id || null;
        navigateToDirectory(null, { id: pid });
      }
    });

    return li;
  }

  // ============================================================================
  // Toggle expand/collapse + lazy load children
  // ============================================================================
  async function toggleExpand(li, node) {
    const isExpanded = li.getAttribute('aria-expanded') === 'true';
    const arrow = li.querySelector('.tree-arrow');

    if (isExpanded) {
      // Collapse: remove all descendant <li> elements
      let next = li.nextElementSibling;
      while (next && next.dataset.depth > li.dataset.depth) {
        const toRemove = next;
        next = next.nextElementSibling;
        toRemove.remove();
      }
      arrow.classList.remove('expanded');
      arrow.textContent = '▶';
      li.setAttribute('aria-expanded', 'false');
    } else {
      // Expand: lazy load children from API
      arrow.classList.add('expanded');
      arrow.textContent = '▼';
      li.setAttribute('aria-expanded', 'true');

      try {
        const data = await window.api.getTree(node.id);
        const children = data.nodes || [];

        // Insert children <li> after current node
        let insertAfter = li;
        children.forEach(child => {
          const childLi = renderNode(child, (parseInt(li.dataset.depth) || 0) + 1);
          childLi.dataset.depth = (parseInt(li.dataset.depth) || 0) + 1;
          insertAfter.after(childLi);
          insertAfter = childLi;
        });
      } catch (err) {
        arrow.classList.remove('expanded');
        arrow.textContent = '▶';
        li.setAttribute('aria-expanded', 'false');
      }
    }
  }

  // ============================================================================
  // Navigate to directory — emit event for grid refresh
  // ============================================================================
  function navigateToDirectory(li, node) {
    // Update selection visual
    if (li) {
      document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
    }
    // Emit state change
    window.appState.setCurrentDirectory(node.id);
  }

  // ============================================================================
  // Initial load — root directory
  // ============================================================================
  async function loadRoot() {
    treeContainer.innerHTML = '';

    try {
      const data = await window.api.getTree(null);
      const nodes = data.nodes || [];

      const ul = document.createElement('ul');
      ul.setAttribute('role', 'tree');
      ul.style.listStyle = 'none';
      ul.style.padding = '0';
      ul.style.margin = '0';

      nodes.forEach(node => {
        const li = renderNode(node, 0);
        li.dataset.depth = '0';
        ul.appendChild(li);
      });

      treeContainer.appendChild(ul);
    } catch (err) {
      treeContainer.innerHTML = '<p style="padding:12px;color:var(--color-text-muted)">加载失败</p>';
    }
  }

  // ============================================================================
  // Listen for selection changes (from grid or other components)
  // ============================================================================
  window.appState.on('selection-changed', function(data) {
    document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
    if (data.nodeId) {
      const li = document.querySelector(`.tree-node[data-node-id="${data.nodeId}"]`);
      if (li) li.classList.add('selected');
    }
  });

  // Full refresh — reload only the root; expanded nodes will be re-expanded
  // (Does NOT destroy entire tree — refreshes root children only)
  window.appState.on('refresh-all', function() {
    refreshRootChildren();
  });

  // Incremental refresh — reload children of a specific expanded tree node
  window.appState.on('tree-refresh-node', function(data) {
    if (!data || !data.parentDirId) return;
    const li = document.querySelector('.tree-node[data-node-id="' + data.parentDirId + '"]');
    if (li && li.getAttribute('aria-expanded') === 'true') {
      // Remove current children
      let next = li.nextElementSibling;
      while (next && parseInt(next.dataset.depth) > parseInt(li.dataset.depth)) {
        const toRemove = next;
        next = next.nextElementSibling;
        toRemove.remove();
      }
      // Re-expand to lazy-load fresh children
      li.setAttribute('aria-expanded', 'false');
      const arrow = li.querySelector('.tree-arrow');
      if (arrow) {
        arrow.classList.remove('expanded');
        arrow.textContent = '▶';
      }
      toggleExpand(li, { id: data.parentDirId });
    }
  });

  // Refresh only root-level children (preserves expanded state of root nodes)
  async function refreshRootChildren() {
    try {
      const data = await window.api.getTree(null);
      const nodes = data.nodes || [];

      // Remove existing root-level children
      const ul = treeContainer.querySelector('ul[role="tree"]');
      if (ul) ul.remove();

      // Re-render root
      const newUl = document.createElement('ul');
      newUl.setAttribute('role', 'tree');
      newUl.style.listStyle = 'none';
      newUl.style.padding = '0';
      newUl.style.margin = '0';

      nodes.forEach(node => {
        const li = renderNode(node, 0);
        li.dataset.depth = '0';
        newUl.appendChild(li);
      });

      treeContainer.appendChild(newUl);
    } catch (err) {
      // silent — tree stays as-is
    }
  }

  // Programmatically select and highlight a directory node in the tree
  window.selectTreeNode = async function(nodeId) {
    if (!nodeId) return;
    // Try to find the node in current DOM
    let li = document.querySelector('.tree-node[data-node-id="' + nodeId + '"]');
    if (!li) {
      // Need to expand ancestors first — reload tree from scratch
      // (simpler approach; could optimize with incremental load)
      await loadRoot();
      li = document.querySelector('.tree-node[data-node-id="' + nodeId + '"]');
    }
    if (li) {
      // Expand ancestors so the node is visible
      let parent = li.parentElement;
      while (parent && parent !== treeContainer) {
        if (parent.tagName === 'UL') {
          const parentLi = parent.closest('.tree-node');
          if (parentLi && parentLi.getAttribute('aria-expanded') === 'false') {
            parentLi.querySelector('.tree-arrow').click();
          }
        }
        parent = parent.parentElement;
      }
      // Highlight
      document.querySelectorAll('.tree-node.selected').forEach(function(el) { el.classList.remove('selected'); });
      li.classList.add('selected');
      li.scrollIntoView({ block: 'nearest' });
    }
  };

  // ============================================================================
  // Mobile: hamburger toggle
  // ============================================================================
  const hamburger = document.getElementById('hamburger');
  const treePanel = document.getElementById('tree-panel');
  const overlayBackdrop = document.getElementById('overlay-backdrop');

  if (hamburger && treePanel) {
    hamburger.addEventListener('click', function() {
      const isOpen = treePanel.classList.toggle('open');
      overlayBackdrop.classList.toggle('visible', isOpen);
      overlayBackdrop.hidden = !isOpen;
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    overlayBackdrop.addEventListener('click', function() {
      treePanel.classList.remove('open');
      overlayBackdrop.classList.remove('visible');
      overlayBackdrop.hidden = true;
      hamburger.setAttribute('aria-expanded', 'false');
    });
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', loadRoot);
})();
