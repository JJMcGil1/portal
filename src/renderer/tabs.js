// Tab management — CRUD, rendering, loading bar
// Tab views (WebContentsView) are managed by the main process.
// The renderer communicates tab operations via IPC.

import { PiX } from 'react-icons/pi';
import { MdOutlineTab } from 'react-icons/md';
import { state, nextTabId } from './state.js';
import { getDomain, getInitial, escapeHtml, escapeAttr } from './utils.js';
import { urlInput, welcome, tabsList, pinnedList, sidebarPinnedTabs, tabContextMenu } from './dom.js';

import { renderIcon } from './icon.js';

// Pre-render the default tab icon SVG once
const defaultTabIconSvg = renderIcon(MdOutlineTab, 14);

// --- Bounds tracking ---
// Sends the content-frame position/size to the main process so it can
// position the active WebContentsView exactly over the content area.

export function setupBoundsTracking() {
  const contentFrame = document.querySelector('.content-frame');

  function sendBounds() {
    const rect = contentFrame.getBoundingClientRect();
    const style = getComputedStyle(contentFrame);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    window.portal.setTabViewBounds({
      x: Math.round(rect.x + borderLeft),
      y: Math.round(rect.y + borderTop),
      width: Math.round(contentFrame.clientWidth),
      height: Math.round(contentFrame.clientHeight),
    });
  }

  const observer = new ResizeObserver(sendBounds);
  observer.observe(contentFrame);
  window.addEventListener('resize', sendBounds);

  // Initial bounds after layout settles
  requestAnimationFrame(() => sendBounds());
}

// --- Tab view event handlers (main -> renderer) ---

export function setupTabViewEvents() {
  window.portal.onTabDidStartLoading((tabId) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.loading = true;
      showLoadingBar(tabId);
    }
  });

  window.portal.onTabDidStopLoading((tabId) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.loading = false;
      hideLoadingBar(tabId);
    }
  });

  window.portal.onTabPageTitleUpdated((tabId, title) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Google auth detection: if blocked, open in system browser
    if (title && title.toLowerCase().includes("couldn't sign you in")) {
      window.portal.openExternal(tab.url);
    }

    // Pinned tabs: don't update title — keep pinned identity frozen
    if (tab.pinned) return;
    tab.title = title || getDomain(tab.url);
    persistUpdateTab(tabId, { title: tab.title });
    renderTabs();
  });

  window.portal.onTabPageFaviconUpdated((tabId, favicons) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    // Pinned tabs: don't update favicon — keep pinned identity frozen
    if (tab.pinned) return;
    if (favicons && favicons.length > 0) {
      tab.favicon = favicons[0];
      persistUpdateTab(tabId, { favicon: tab.favicon });
      renderTabs();
    }
  });

  window.portal.onTabDidNavigate((tabId, url) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    // Pinned tabs: don't update anything — keep the pinned identity frozen
    if (tab.pinned) return;
    tab.url = url;
    persistUpdateTab(tabId, { url: tab.url });
    if (state.activeTabId === tabId) {
      urlInput.value = url;
    }
  });

  window.portal.onTabDidNavigateInPage((tabId, url, isMainFrame) => {
    if (!isMainFrame) return;
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    // Pinned tabs: don't update anything — keep the pinned identity frozen
    if (tab.pinned) return;
    tab.url = url;
    persistUpdateTab(tabId, { url: tab.url });
    if (state.activeTabId === tabId) {
      urlInput.value = url;
    }
  });

  window.portal.onTabNewWindow((url) => {
    if (url) createTab(url);
  });
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
    pinnedUrl: null,
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
    pinnedUrl: null,
  };
  state.tabs.push(tab);

  // Create tab view in main process
  window.portal.createTabView(id, url);

  activateTab(id);
  renderTabs();
  persistCreateTab(tab);
  return tab;
}

// Restore a tab from the database (on app startup)
export function restoreTab(dbRow) {
  // Don't restore ephemeral OAuth/auth tabs — their tokens are expired
  if (dbRow.url && (
    dbRow.url.includes('accounts.google.com/o/oauth2') ||
    dbRow.url.includes('accounts.google.com/signin/oauth') ||
    dbRow.url.includes('appleid.apple.com/auth')
  )) {
    return null;
  }
  const isPinned = !!dbRow.is_pinned;
  const tab = {
    id: dbRow.id,
    url: dbRow.url,
    title: dbRow.title || getDomain(dbRow.url) || 'New Tab',
    favicon: dbRow.favicon || null,
    loading: false,
    pinned: isPinned,
    pinnedUrl: isPinned ? dbRow.url : null,
  };
  state.tabs.push(tab);

  if (tab.url) {
    window.portal.createTabView(tab.id, tab.url);
  }

  // Sync pinned state to main process so will-navigate interception works
  if (isPinned && tab.url) {
    window.portal.setPinnedTab(tab.id, tab.url);
  }

  return tab;
}

// Navigate an existing tab to a new URL
export function navigateTab(id, url) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;

  // Pinned tabs: open URL in a new tab instead of navigating the pinned one
  if (tab.pinned) {
    createTab(url);
    return;
  }

  const hadUrl = tab.url !== '';
  tab.url = url;
  tab.title = getDomain(url);
  tab.favicon = null;
  tab.loading = true;

  if (hadUrl) {
    // Tab view already exists — navigate it
    window.portal.navigateTabView(id, url);
  } else {
    // New Tab had no view — create one
    window.portal.createTabView(id, url);
  }

  // Show the tab view, hide welcome
  welcome.classList.add('hidden');
  window.portal.showTabView(id);

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
    window.portal.showTabView(id);
  } else {
    window.portal.hideAllTabViews();
  }

  persistUpdateTab(id, { isActive: true });
  renderTabs();
}

export function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  // Pinned tabs cannot be closed — must unpin first
  if (state.tabs[idx].pinned) return;

  state.tabs.splice(idx, 1);

  // Destroy the tab view in main process
  window.portal.destroyTabView(id);

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
      window.portal.hideAllTabViews();
    }
  }

  renderTabs();
}

export function pinTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.pinned = true;
  tab.pinnedUrl = tab.url; // remember the URL this tab was pinned at
  persistUpdateTab(id, { isPinned: true });
  window.portal.setPinnedTab(id, tab.url); // sync to main process for nav interception
  renderTabs();
}

export function unpinTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.pinned = false;
  tab.pinnedUrl = null;
  persistUpdateTab(id, { isPinned: false });
  window.portal.unsetPinnedTab(id); // clear from main process
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

  // Hide "Close tab" for pinned tabs — unpin is the only way to remove them
  const closeItem = tabContextMenu.querySelector('[data-action="close"]');
  if (closeItem) closeItem.style.display = tab.pinned ? 'none' : '';

  // Hide the active tab view so the context menu renders on top of the native WebContentsView
  window.portal.hideAllTabViews();

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
  // Restore the active tab view
  if (state.activeTabId) {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (tab && tab.url) {
      window.portal.showTabView(state.activeTabId);
    }
  }
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
