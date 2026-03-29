// Tab management — CRUD, rendering, loading bar

import { PiX } from 'react-icons/pi';
import { state, nextTabId } from './state.js';
import { getDomain, getInitial, escapeHtml, escapeAttr } from './utils.js';
import { urlInput, webviewContainer, welcome, tabsList } from './dom.js';
import { renderIcon } from './icon.js';

// --- Persist helpers ---

function persistCreateTab(tab) {
  window.portal.createTabInDb({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon || null,
    position: state.tabs.indexOf(tab),
    isActive: state.activeTabId === tab.id,
  });
}

function persistUpdateTab(id, fields) {
  window.portal.updateTab(id, fields);
}

function persistDeleteTab(id) {
  window.portal.deleteTab(id);
}

// --- Tab operations ---

export function createNewTab() {
  const id = nextTabId();
  const tab = {
    id,
    url: '',
    title: 'New Tab',
    favicon: null,
    loading: false,
  };
  state.tabs.push(tab);
  activateTab(id);
  renderTabs();
  persistCreateTab(tab);
  urlInput.value = '';
  urlInput.focus();
  urlInput.select();
  return tab;
}

export function createTab(url) {
  const id = nextTabId();
  const tab = {
    id,
    url,
    title: getDomain(url),
    favicon: null,
    loading: true,
  };
  state.tabs.push(tab);

  attachWebview(tab);
  activateTab(id);
  renderTabs();
  persistCreateTab(tab);
  return tab;
}

// Restore a tab from the database (on app startup)
export function restoreTab(dbRow) {
  const tab = {
    id: dbRow.id,
    url: dbRow.url,
    title: dbRow.title || getDomain(dbRow.url) || 'New Tab',
    favicon: dbRow.favicon || null,
    loading: false,
  };
  state.tabs.push(tab);

  if (tab.url) {
    attachWebview(tab);
  }

  return tab;
}

// Navigate an existing tab to a new URL (used when navigating from "New Tab")
export function navigateTab(id, url) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;

  tab.url = url;
  tab.title = getDomain(url);
  tab.favicon = null;
  tab.loading = true;

  // Create webview if this was a New Tab (no webview yet)
  const existingWv = webviewContainer.querySelector(`webview[data-tab-id="${id}"]`);
  if (existingWv) {
    existingWv.setAttribute('src', url);
  } else {
    attachWebview(tab);
  }

  persistUpdateTab(id, { url: tab.url, title: tab.title, favicon: null });
  renderTabs();
}

function attachWebview(tab) {
  const webview = document.createElement('webview');
  webview.setAttribute('src', tab.url);
  webview.setAttribute('data-tab-id', tab.id);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('partition', 'persist:portal');
  webviewContainer.appendChild(webview);

  webview.addEventListener('did-start-loading', () => {
    tab.loading = true;
    showLoadingBar(tab.id);
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    hideLoadingBar(tab.id);
  });

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || getDomain(tab.url);
    persistUpdateTab(tab.id, { title: tab.title });
    renderTabs();
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      tab.favicon = e.favicons[0];
      persistUpdateTab(tab.id, { favicon: tab.favicon });
      renderTabs();
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    persistUpdateTab(tab.id, { url: tab.url });
    if (state.activeTabId === tab.id) {
      urlInput.value = e.url;
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      tab.url = e.url;
      persistUpdateTab(tab.id, { url: tab.url });
      if (state.activeTabId === tab.id) {
        urlInput.value = e.url;
      }
    }
  });
}

export function activateTab(id) {
  state.activeTabId = id;
  const tab = state.tabs.find((t) => t.id === id);

  if (tab) {
    urlInput.value = tab.url;
  }

  // Show welcome screen if this is a new tab with no URL
  const hasWebview = tab && tab.url !== '';
  webviewContainer.querySelectorAll('webview').forEach((wv) => {
    wv.classList.toggle('active', parseInt(wv.getAttribute('data-tab-id')) === id);
  });

  welcome.classList.toggle('hidden', hasWebview);
  persistUpdateTab(id, { isActive: true });
  renderTabs();
}

export function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  state.tabs.splice(idx, 1);

  const wv = webviewContainer.querySelector(`webview[data-tab-id="${id}"]`);
  if (wv) wv.remove();

  const bar = document.querySelector(`.loading-bar[data-tab-id="${id}"]`);
  if (bar) bar.remove();

  persistDeleteTab(id);

  if (state.activeTabId === id) {
    if (state.tabs.length > 0) {
      const nextIdx = Math.min(idx, state.tabs.length - 1);
      activateTab(state.tabs[nextIdx].id);
    } else {
      state.activeTabId = null;
      urlInput.value = '';
      welcome.classList.remove('hidden');
    }
  }

  renderTabs();
}

export function getActiveWebview() {
  if (!state.activeTabId) return null;
  return webviewContainer.querySelector(
    `webview[data-tab-id="${state.activeTabId}"]`
  );
}

export function renderTabs() {
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
        ${renderIcon(PiX, 10)}
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
