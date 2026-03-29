// Event binding

import { state } from './state.js';
import { normalizeUrl } from './utils.js';
import { urlInput, newTabBtn, saveSiteBtn, devtoolsBtn, backBtn, forwardBtn, reloadBtn, themeToggleBtn } from './dom.js';
import { createTab, createNewTab, navigateTab, closeTab, getActiveWebview } from './tabs.js';
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
        closeTab(state.activeTabId);
      }
    }
  });

  newTabBtn.addEventListener('click', () => {
    createNewTab();
  });

  saveSiteBtn.addEventListener('click', saveCurrent);
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Navigation — direct webview method calls
  devtoolsBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) {
      // Use IPC to toggle devtools since webview.openDevTools() isn't directly available
      const wcId = wv.getWebContentsId();
      window.portal.toggleDevTools(wcId);
    }
  });

  backBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoBack()) {
      wv.goBack();
    }
  });

  forwardBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv && wv.canGoForward()) {
      wv.goForward();
    }
  });

  reloadBtn.addEventListener('click', () => {
    const wv = getActiveWebview();
    if (wv) {
      wv.reload();
    }
  });
}
