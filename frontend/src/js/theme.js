/* theme.js — Dark/Light mode toggle
   Feature: 002-frontend-ux | Constitution: FR-021 */

(function() {
  'use strict';

  const THEME_KEY = 'cloud-drive-theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  // ============================================================================
  // Initialize: respect system preference, then user override
  // ============================================================================
  function getInitialTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === DARK || stored === LIGHT) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Update toggle button visibility
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');
    if (lightIcon && darkIcon) {
      lightIcon.style.display = theme === DARK ? 'inline' : 'none';
      darkIcon.style.display = theme === DARK ? 'none' : 'inline';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === DARK ? LIGHT : DARK;
    applyTheme(next);
  }

  // ============================================================================
  // Bind to DOM
  // ============================================================================
  document.addEventListener('DOMContentLoaded', function() {
    // Apply initial theme
    const initialTheme = getInitialTheme();
    applyTheme(initialTheme);

    // Bind toggle button
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleTheme);
    }
  });

  // Expose for programmatic use
  window.toggleTheme = toggleTheme;
  window.getCurrentTheme = () => document.documentElement.getAttribute('data-theme');
})();
