/* auth.js — Authentication manager (JWT token, login/register/logout)
   Feature: User authentication (step 2 optimization) */

(function() {
  'use strict';

  const API_BASE = 'http://localhost:8081/api/v1';
  const TOKEN_KEY = 'cloud_drive_token';
  const USER_KEY = 'cloud_drive_user';

  // ============================================================================
  // Token Management
  // ============================================================================

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  // ============================================================================
  // API Calls
  // ============================================================================

  async function login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || '登录失败');
    saveSession(data.token, data.user);
    return data;
  }

  async function register(username, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || '注册失败');
    return data;
  }

  function logout() {
    clearSession();
    window.location.href = '/login.html';
  }

  // ============================================================================
  // Auth Guard — redirect to login if not authenticated
  // ============================================================================

  function requireAuth() {
    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  function getOperatorId() {
    const user = getUser();
    return user ? user.id : null;
  }

  // ============================================================================
  // Login Page Logic (only runs on login.html)
  // ============================================================================

  function initLoginPage() {
    const form = document.getElementById('auth-form');
    if (!form) return; // not on login page

    const modeTitle = document.getElementById('mode-title');
    const modeSub = document.getElementById('mode-sub');
    const confirmGroup = document.getElementById('confirm-group');
    const submitBtn = document.getElementById('submit-btn');
    const toggleLink = document.getElementById('toggle-link');
    const toggleText = document.getElementById('toggle-text');
    const errorEl = document.getElementById('login-error');

    let isRegister = false;

    function setMode(register) {
      isRegister = register;
      if (register) {
        modeTitle.textContent = '注册';
        modeSub.textContent = '创建你的云盘账户';
        confirmGroup.style.display = '';
        submitBtn.textContent = '注册';
        toggleText.textContent = '已有账户？';
        toggleLink.textContent = '登录';
      } else {
        modeTitle.textContent = '登录';
        modeSub.textContent = '登录你的云盘账户';
        confirmGroup.style.display = 'none';
        submitBtn.textContent = '登录';
        toggleText.textContent = '没有账户？';
        toggleLink.textContent = '注册';
      }
      errorEl.classList.remove('visible');
      errorEl.textContent = '';
    }

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.classList.add('visible');
    }

    toggleLink.addEventListener('click', function() {
      setMode(!isRegister);
    });

    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      errorEl.classList.remove('visible');
      submitBtn.disabled = true;

      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      try {
        if (isRegister) {
          const confirm = document.getElementById('confirm-password').value;
          if (password !== confirm) {
            showError('两次输入的密码不一致');
            submitBtn.disabled = false;
            return;
          }
          if (password.length < 6) {
            showError('密码长度至少 6 位');
            submitBtn.disabled = false;
            return;
          }
          await register(username, password);
          // Auto-login after register
          await login(username, password);
        } else {
          await login(username, password);
        }
        window.location.href = '/';
      } catch (err) {
        showError(err.message);
        submitBtn.disabled = false;
      }
    });

    // If already logged in, redirect to main
    if (getToken()) {
      window.location.href = '/';
    }
  }

  // ============================================================================
  // Expose to global namespace
  // ============================================================================

  window.Auth = {
    getToken,
    getUser,
    login,
    register,
    logout,
    requireAuth,
    getOperatorId,
    clearSession
  };

  // Run login page init
  initLoginPage();
})();
