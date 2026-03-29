// Tab management — CRUD, rendering, loading bar

import { PiX } from 'react-icons/pi';
import { MdOutlineTab } from 'react-icons/md';
import { state, nextTabId } from './state.js';
import { getDomain, getInitial, escapeHtml, escapeAttr } from './utils.js';
import { urlInput, welcome, tabsList, pinnedList, sidebarPinnedTabs, tabContextMenu, webviewContainer } from './dom.js';

import { renderIcon } from './icon.js';

// Pre-render the default tab icon SVG once
const defaultTabIconSvg = renderIcon(MdOutlineTab, 14);

// --- Webview map: tabId → <webview> element ---
const webviews = new Map();

// --- Helpers ---

function getActiveWebview() {
  if (!state.activeTabId) return null;
  return webviews.get(state.activeTabId) || null;
}

// Expose for events.js
export { getActiveWebview };

function createWebview(tabId, url) {
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:portal');
  wv.setAttribute('allowpopups', '');
  wv.classList.add('tab-webview');
  wv.dataset.tabId = tabId;

  // Initially hidden
  wv.style.display = 'none';

  // Set src
  if (url) {
    wv.setAttribute('src', url);
  }

  // Wire up events
  wv.addEventListener('did-start-loading', () => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.loading = true;
      showLoadingBar(tabId);
    }
  });

  wv.addEventListener('did-stop-loading', () => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.loading = false;
      hideLoadingBar(tabId);
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.title = e.title || getDomain(tab.url);
    persistUpdateTab(tabId, { title: tab.title });
    renderTabs();

    // Google auth detection: if blocked, open in system browser
    if (e.title.toLowerCase().includes("couldn't sign you in")) {
      const currentUrl = wv.getURL();
      window.portal.openExternal(currentUrl);
      wv.loadURL('about:blank');
      wv.executeJavaScript(`
        document.body.style.cssText = 'background:#0a0a0b;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0';
        document.body.innerHTML = '<div style="text-align:center;max-width:400px"><h2 style="font-weight:600;margin-bottom:12px">Signing in via your browser</h2><p style="color:#888;line-height:1.6">Google requires sign-in from a standard browser. A window has been opened in your default browser.<br><br>After signing in, come back here and reload the page.</p></div>';
      `).catch(() => {});
    }
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (e.favicons && e.favicons.length > 0) {
      tab.favicon = e.favicons[0];
      persistUpdateTab(tabId, { favicon: tab.favicon });
      renderTabs();
    }
  });

  wv.addEventListener('did-navigate', (e) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.url = e.url;
    persistUpdateTab(tabId, { url: tab.url });
    if (state.activeTabId === tabId) {
      urlInput.value = e.url;
    }
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.url = e.url;
    persistUpdateTab(tabId, { url: tab.url });
    if (state.activeTabId === tabId) {
      urlInput.value = e.url;
    }
  });

  // New window requests → open as new tab
  wv.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url) {
      createTab(e.url);
    }
  });

  // Add to container
  webviewContainer.appendChild(wv);
  webviews.set(tabId, wv);
  return wv;
}

function destroyWebview(tabId) {
  const wv = webviews.get(tabId);
  if (wv) {
    wv.remove();
    webviews.delete(tabId);
  }
}

function showWebview(tabId) {
  // Hide all, show the active one
  for (const [id, wv] of webviews) {
    wv.style.display = id === tabId ? '' : 'none';
  }
}

function hideAllWebviews() {
  for (const [, wv] of webviews) {
    wv.style.display = 'none';
  }
}

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
    pinned: false,
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
    pinned: false,
  };
  state.tabs.push(tab);

  // Create webview
  createWebview(id, url);

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
    pinned: !!dbRow.is_pinned,
  };
  state.tabs.push(tab);

  if (tab.url) {
    createWebview(tab.id, tab.url);
  }

  return tab;
}

// Navigate an existing tab to a new URL
export function navigateTab(id, url) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;

  const hadUrl = tab.url !== '';
  tab.url = url;
  tab.title = getDomain(url);
  tab.favicon = null;
  tab.loading = true;

  if (hadUrl) {
    // Webview already exists — navigate it
    const wv = webviews.get(id);
    if (wv) {
      wv.loadURL(url);
    }
  } else {
    // New Tab had no webview — create one
    createWebview(id, url);
  }

  // Show the webview, hide welcome
  welcome.classList.add('hidden');
  showWebview(id);

  persistUpdateTab(id, { url: tab.url, title: tab.title, favicon: null });
  renderTabs();
}

export function activateTab(id) {
  state.activeTabId = id;
  const tab = state.tabs.find((t) => t.id === id);

  if (tab) {
    urlInput.value = tab.url;
  }

  // Show welcome screen if this is a new tab with no URL
  const hasUrl = tab && tab.url !== '';
  welcome.classList.toggle('hidden', hasUrl);

  if (hasUrl) {
    showWebview(id);
  } else {
    hideAllWebviews();
  }

  persistUpdateTab(id, { isActive: true });
  renderTabs();
}

export function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  state.tabs.splice(idx, 1);

  // Destroy the webview
  destroyWebview(id);

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
      hideAllWebviews();
    }
  }

  renderTabs();
}

export function pinTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.pinned = true;
  persistUpdateTab(id, { isPinned: true });
  renderTabs();
}

export function unpinTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.pinned = false;
  persistUpdateTab(id, { isPinned: false });
  renderTabs();
}

function buildFaviconHtml(tab) {
  const fallback = tab.url
    ? `<div class="tab-favicon-placeholder"><span>${escapeHtml(getInitial(tab.url))}</span></div>`
    : `<div class="tab-favicon-placeholder tab-favicon-icon">${defaultTabIconSvg}</div>`;
  return tab.favicon
    ? `<img class="tab-favicon" src="${escapeAttr(tab.favicon)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + (tab.url ? `<div class="tab-favicon-placeholder" style="display:none"><span>${escapeHtml(getInitial(tab.url))}</span></div>` : `<div class="tab-favicon-placeholder tab-favicon-icon" style="display:none">${defaultTabIconSvg}</div>`)
    : fallback;
}

// --- Drag-and-drop for pinned tabs ---

let dragState = null;

function setupPinnedDrag(el, tab) {
  el.setAttribute('draggable', 'true');

  el.addEventListener('dragstart', (e) => {
    dragState = { tabId: tab.id };
    el.classList.add('pinned-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('pinned-dragging');
    pinnedList.querySelectorAll('.pinned-item').forEach(item => item.classList.remove('pinned-drag-over'));
    dragState = null;
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragState || dragState.tabId === tab.id) return;
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('pinned-drag-over');
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('pinned-drag-over');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('pinned-drag-over');
    if (!dragState || dragState.tabId === tab.id) return;

    const pinnedTabs = state.tabs.filter(t => t.pinned);
    const fromIdx = pinnedTabs.findIndex(t => t.id === dragState.tabId);
    const toIdx = pinnedTabs.findIndex(t => t.id === tab.id);

    if (fromIdx !== -1 && toIdx !== -1) {
      const [moved] = pinnedTabs.splice(fromIdx, 1);
      pinnedTabs.splice(toIdx, 0, moved);
      const unpinnedTabs = state.tabs.filter(t => !t.pinned);
      state.tabs = [...pinnedTabs, ...unpinnedTabs];
      window.portal.reorderPinnedTabs(pinnedTabs.map(t => t.id));
      renderTabs();
    }
  });
}

let contextTabId = null;

function showContextMenu(e, tab) {
  e.preventDefault();
  contextTabId = tab.id;

  const pinLabel = document.getElementById('ctx-pin-label');
  pinLabel.textContent = tab.pinned ? 'Unpin tab' : 'Pin tab';

  const menu = tabContextMenu;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.add('open');

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}

function hideContextMenu() {
  tabContextMenu.classList.remove('open');
  contextTabId = null;
}

export function setupTabContextMenu() {
  tabContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item || contextTabId === null) return;

    const action = item.dataset.action;
    const tab = state.tabs.find((t) => t.id === contextTabId);

    if (action === 'pin' && tab) {
      if (tab.pinned) unpinTab(tab.id);
      else pinTab(tab.id);
    } else if (action === 'save') {
      import('./saved.js').then(({ saveCurrent }) => saveCurrent());
    } else if (action === 'close') {
      closeTab(contextTabId);
    }

    hideContextMenu();
  });

  document.addEventListener('click', (e) => {
    if (!tabContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });
}

export function renderTabs() {
  const pinnedTabs = state.tabs.filter((t) => t.pinned);
  const unpinnedTabs = state.tabs.filter((t) => !t.pinned);

  sidebarPinnedTabs.style.display = pinnedTabs.length > 0 ? '' : 'none';

  pinnedList.innerHTML = '';
  pinnedTabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `pinned-item${tab.id === state.activeTabId ? ' active' : ''}`;
    el.dataset.tabId = tab.id;
    el.innerHTML = `
      ${buildFaviconHtml(tab)}
      <span class="pinned-title">${escapeHtml(tab.title)}</span>
    `;

    el.addEventListener('click', () => activateTab(tab.id));
    el.addEventListener('contextmenu', (e) => showContextMenu(e, tab));
    setupPinnedDrag(el, tab);

    pinnedList.appendChild(el);
  });

  tabsList.innerHTML = '';

  unpinnedTabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab-item${tab.id === state.activeTabId ? ' active' : ''}`;

    el.innerHTML = `
      ${buildFaviconHtml(tab)}
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

    el.addEventListener('contextmenu', (e) => showContextMenu(e, tab));
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
