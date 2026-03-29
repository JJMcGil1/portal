// Tab management — CRUD, rendering, loading bar

import { PiX } from 'react-icons/pi';
import { MdOutlineTab } from 'react-icons/md';
import { state, nextTabId } from './state.js';
import { getDomain, getInitial, escapeHtml, escapeAttr } from './utils.js';
import { urlInput, webviewContainer, welcome, tabsList, pinnedList, sidebarPinnedTabs, tabContextMenu } from './dom.js';
// Note: saveCurrent is imported lazily to avoid circular deps with saved.js

import { renderIcon } from './icon.js';

// Pre-render the default tab icon SVG once
const defaultTabIconSvg = renderIcon(MdOutlineTab, 14);

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
    pinned: !!dbRow.is_pinned,
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

  // Hide welcome screen and show the webview
  welcome.classList.add('hidden');
  webviewContainer.querySelectorAll('webview').forEach((wv) => {
    wv.classList.toggle('active', parseInt(wv.getAttribute('data-tab-id')) === id);
  });

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
    // Minimal ghost
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

  // Update pin label
  const pinLabel = document.getElementById('ctx-pin-label');
  pinLabel.textContent = tab.pinned ? 'Unpin tab' : 'Pin tab';

  // Position
  const menu = tabContextMenu;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.add('open');

  // Adjust if overflowing
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
  // Handle menu item clicks
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

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!tabContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });
}

export function renderTabs() {
  const pinnedTabs = state.tabs.filter((t) => t.pinned);
  const unpinnedTabs = state.tabs.filter((t) => !t.pinned);

  // Toggle pinned section visibility
  sidebarPinnedTabs.style.display = pinnedTabs.length > 0 ? '' : 'none';

  // Render pinned tabs
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

  // Render unpinned tabs
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
