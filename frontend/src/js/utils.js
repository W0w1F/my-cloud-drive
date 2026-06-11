/* utils.js — Shared utility functions
   Extracted from grid.js + upload.js to eliminate duplication */

(function() {
  'use strict';

  function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return Math.floor(diffSec / 60) + ' 分钟前';
    if (diffSec < 86400) return Math.floor(diffSec / 3600) + ' 小时前';
    if (diffSec < 2592000) return Math.floor(diffSec / 86400) + ' 天前';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  }

  window.formatFileSize = formatFileSize;
  window.formatRelativeTime = formatRelativeTime;
})();
