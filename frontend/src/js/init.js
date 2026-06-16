/* init.js — Page initialization (auth guard + splash)
   Extracted from index.html inline scripts to avoid CSP 'unsafe-inline' */

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    // Auth guard — redirect to login if no valid token
    if (!window.Auth || !window.Auth.requireAuth()) return;

    // Display username
    var user = window.Auth.getUser();
    if (user) {
      var el = document.getElementById('header-user');
      if (el) el.textContent = user.username;
    }

    // Logout button
    var btn = document.getElementById('btn-logout');
    if (btn) {
      btn.addEventListener('click', function() {
        window.Auth.logout();
      });
    }
  });

  // Splash skip on click
  var splash = document.getElementById('splash');
  if (splash) {
    splash.addEventListener('click', function() { splash.remove(); });
  }
})();
