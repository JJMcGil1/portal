// ============================================
// Portal — Renderer
// ============================================

const state = {
  tabs: [],
  activeTabId: null,
  saved: [],
};

let tabIdCounter = 0;

// DOM refs
const urlInput = document.getElementById('url-input');
const tabsList = document.getElementById('tabs-list');
const savedList = document.getElementById('saved-list');
const webviewContainer = document.getElementById('webview-container');
const welcome = document.getElementById('welcome');
const newTabBtn = document.getElementById('new-tab-btn');
const saveSiteBtn = document.getElementById('save-site-btn');
const devtoolsBtn = document.getElementById('devtools-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const titlebarTitle = document.getElementById('titlebar-title');
const titlebarUrl = document.getElementById('titlebar-url');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// ============================================
// Init
// ============================================

async function init() {
  const data = await window.portal.loadData();
  state.saved = data.sites || [];
  renderSaved();
  setupEvents();
}

// ============================================
// URL Handling
// ============================================

function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;

  // If it looks like a domain (has a dot, no spaces)
  if (/^[^\s]+\.[^\s]+$/.test(url) && !url.startsWith('http')) {
    url = 'https://' + url;
  }

  // If it doesn't start with http, it's probably not a valid URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }

  return url;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function getInitial(url) {
  const domain = getDomain(url);
  return domain.charAt(0).toUpperCase();
}

// ============================================
// Tab Management
// ============================================

function createTab(url) {
  const id = ++tabIdCounter;
  const tab = {
    id,
    url,
    title: getDomain(url),
    favicon: null,
    loading: true,
  };
  state.tabs.push(tab);

  // Create webview
  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('data-tab-id', id);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('partition', 'persist:portal');
  webviewContainer.appendChild(webview);

  // Webview events
  webview.addEventListener('did-start-loading', () => {
    tab.loading = true;
    showLoadingBar(id);
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    hideLoadingBar(id);
  });

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || getDomain(tab.url);
    renderTabs();
    updateTitlebar();
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      tab.favicon = e.favicons[0];
      renderTabs();
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (state.activeTabId === id) {
      urlInput.value = e.url;
      updateTitlebar();
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      tab.url = e.url;
      if (state.activeTabId === id) {
        urlInput.value = e.url;
        updateTitlebar();
      }
    }
  });

  activateTab(id);
  renderTabs();
  return tab;
}

function activateTab(id) {
  state.activeTabId = id;
  const tab = state.tabs.find((t) => t.id === id);

  // Update URL bar
  if (tab) {
    urlInput.value = tab.url;
  }

  // Show/hide webviews
  webviewContainer.querySelectorAll('webview').forEach((wv) => {
    if (parseInt(wv.getAttribute('data-tab-id')) === id) {
      wv.classList.add('active');
    } else {
      wv.classList.remove('active');
    }
  });

  // Toggle welcome screen
  welcome.classList.toggle('hidden', state.tabs.length > 0);

  renderTabs();
  updateTitlebar();
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  state.tabs.splice(idx, 1);

  // Remove webview
  const wv = webviewContainer.querySelector(`webview[data-tab-id="${id}"]`);
  if (wv) wv.remove();

  // Remove loading bar
  const bar = document.querySelector(`.loading-bar[data-tab-id="${id}"]`);
  if (bar) bar.remove();

  // Activate next tab
  if (state.activeTabId === id) {
    if (state.tabs.length > 0) {
      const nextIdx = Math.min(idx, state.tabs.length - 1);
      activateTab(state.tabs[nextIdx].id);
    } else {
      state.activeTabId = null;
      urlInput.value = '';
      welcome.classList.remove('hidden');
      updateTitlebar();
    }
  }

  renderTabs();
}

function getActiveWebview() {
  if (!state.activeTabId) return null;
  return webviewContainer.querySelector(
    `webview[data-tab-id="${state.activeTabId}"]`
  );
}

// ============================================
// Loading Bar
// ============================================

function showLoadingBar(tabId) {
  let bar = document.querySelector(`.loading-bar[data-tab-id="${tabId}"]`);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'loading-bar';
    bar.setAttribute('data-tab-id', tabId);
    document.querySelector('.content-frame').appendChild(bar);
  }
  bar.classList.remove('done');
  bar.style.width = '0%';

  // Animate
  requestAnimationFrame(() => {
    bar.style.width = '30%';
    setTimeout(() => { bar.style.width = '60%'; }, 300);
    setTimeout(() => { bar.style.width = '85%'; }, 800);
  });
}

function hideLoadingBar(tabId) {
  const bar = document.querySelector(`.loading-bar[data-tab-id="${tabId}"]`);
  if (bar) {
    bar.style.width = '100%';
    setTimeout(() => {
      bar.classList.add('done');
      setTimeout(() => bar.remove(), 300);
    }, 200);
  }
}

// ============================================
// Render
// ============================================

function renderTabs() {
  tabsList.innerHTML = '';
  state.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab-item${tab.id === state.activeTabId ? ' active' : ''}`;

    const faviconHtml = tab.favicon
      ? `<img class="tab-favicon" src="${escapeAttr(tab.favicon)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<div class="tab-favicon-placeholder" style="display:none"><span>${escapeHtml(getInitial(tab.url))}</span></div>`
      : `<div class="tab-favicon-placeholder"><span>${escapeHtml(getInitial(tab.url))}</span></div>`;

    el.innerHTML = `
      ${faviconHtml}
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <button class="tab-close" data-id="${tab.id}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        closeTab(tab.id);
      } else {
        activateTab(tab.id);
      }
    });

    tabsList.appendChild(el);
  });
}

function renderSaved() {
  savedList.innerHTML = '';
  state.saved.forEach((site, idx) => {
    const el = document.createElement('div');
    el.className = 'saved-item';

    el.innerHTML = `
      <div class="tab-favicon-placeholder"><span>${escapeHtml(getInitial(site.url))}</span></div>
      <span class="saved-title">${escapeHtml(site.title)}</span>
      <button class="saved-remove" data-idx="${idx}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.saved-remove')) {
        removeSaved(idx);
      } else {
        // Open saved site in a new tab
        createTab(site.url);
      }
    });

    savedList.appendChild(el);
  });
}

// ============================================
// Save / Remove Sites
// ============================================

function saveCurrent() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab) return;

  // Don't duplicate
  if (state.saved.some((s) => s.url === tab.url)) return;

  state.saved.push({
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
  });

  window.portal.saveData({ sites: state.saved });
  renderSaved();
}

function removeSaved(idx) {
  state.saved.splice(idx, 1);
  window.portal.saveData({ sites: state.saved });
  renderSaved();
}

// ============================================
// Events
// ============================================

function setupEvents() {
  // URL input — navigate on Enter
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = normalizeUrl(urlInput.value);
      if (!url) return;

      if (state.activeTabId) {
        // Navigate current tab
        const wv = getActiveWebview();
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (wv && tab) {
          wv.setAttribute('src', url);
          tab.url = url;
          tab.title = getDomain(url);
          tab.favicon = null;
          renderTabs();
        }
      } else {
        createTab(url);
      }
      urlInput.blur();
    }
  });

  // Focus URL bar on Cmd+L
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      urlInput.focus();
      urlInput.select();
    }
    // Cmd+T for new tab
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      urlInput.focus();
      urlInput.select();
      urlInput.value = '';
    }
    // Cmd+W close tab
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (state.activeTabId) {
        closeTab(state.activeTabId);
      }
    }
  });

  // New tab button
  newTabBtn.addEventListener('click', () => {
    urlInput.focus();
    urlInput.select();
    urlInput.value = '';
  });

  // Save site
  saveSiteBtn.addEventListener('click', saveCurrent);

  // Theme toggle
  themeToggleBtn.addEventListener('click', toggleTheme);

  // DevTools
  devtoolsBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) {
      window.portal.toggleDevTools(wv.getWebContentsId());
    }
  });

  // Navigation buttons
  backBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoBack()) wv.goBack();
  });

  forwardBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoForward()) wv.goForward();
  });

  reloadBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) wv.reload();
  });

}

// ============================================
// Titlebar
// ============================================

function updateTitlebar() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (tab) {
    titlebarTitle.textContent = tab.title;
    titlebarUrl.textContent = tab.url;
  } else {
    titlebarTitle.textContent = 'Portal';
    titlebarUrl.textContent = '';
  }
}

// ============================================
// Theme
// ============================================

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('portal-theme', isLight ? 'light' : 'dark');
}

function loadTheme() {
  const saved = localStorage.getItem('portal-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
}

// ============================================
// Helpers
// ============================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// Boot
// ============================================

loadTheme();
init();
