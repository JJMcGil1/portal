// Event binding

import { state } from './state.js';
import { normalizeUrl } from './utils.js';
import { urlInput, newTabBtn, saveSiteBtn, devtoolsBtn, backBtn, forwardBtn, reloadBtn, themeToggleBtn } from './dom.js';
import { createTab, createNewTab, navigateTab, closeTab } from './tabs.js';
import { saveCurrent } from './saved.js';
import { toggleTheme } from './theme.js';

export function setupEvents() {
  // URL input — navigate on Enter
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = normalizeUrl(urlInput.value);
      if (!url) return;

      const activeTab = state.activeTabId ? state.tabs.find((t) => t.id === state.activeTabId) : null;

      if (activeTab && activeTab.url === '') {
        navigateTab(activeTab.id, url);
      } else if (activeTab) {
        navigateTab(activeTab.id, url);
      } else {
        createTab(url);
      }
      urlInput.blur();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      urlInput.focus();
      urlInput.select();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      createNewTab();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (state.activeTabId) {
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (activeTab && !activeTab.pinned) {
          closeTab(state.activeTabId);
        }
      }
    }
  });

  newTabBtn.addEventListener('click', () => {
    createNewTab();
  });

  saveSiteBtn.addEventListener('click', saveCurrent);
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Navigation — via IPC to main process tab views
  devtoolsBtn.addEventListener('click', () => {
    if (state.activeTabId) {
      window.portal.tabToggleDevTools(state.activeTabId);
    }
  });

  backBtn.addEventListener('click', () => {
    if (state.activeTabId) {
      const tab = state.tabs.find(t => t.id === state.activeTabId);
      if (tab && !tab.pinned) window.portal.tabGoBack(state.activeTabId);
    }
  });

  forwardBtn.addEventListener('click', () => {
    if (state.activeTabId) {
      const tab = state.tabs.find(t => t.id === state.activeTabId);
      if (tab && !tab.pinned) window.portal.tabGoForward(state.activeTabId);
    }
  });

  reloadBtn.addEventListener('click', () => {
    if (state.activeTabId) {
      reloadBtn.classList.add('spinning');
      window.portal.tabReload(state.activeTabId);
      setTimeout(() => reloadBtn.classList.remove('spinning'), 600);
    }
  });
}
