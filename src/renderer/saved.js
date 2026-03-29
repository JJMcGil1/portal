// Saved sites management

import { PiX } from 'react-icons/pi';
import { state } from './state.js';
import { getInitial, escapeHtml } from './utils.js';
import { savedList } from './dom.js';
import { createTab } from './tabs.js';
import { renderIcon } from './icon.js';

export function renderSaved() {
  const savedSection = savedList.closest('.sidebar-saved');
  if (savedSection) {
    savedSection.style.display = state.saved.length > 0 ? '' : 'none';
  }

  savedList.innerHTML = '';
  state.saved.forEach((site) => {
    const el = document.createElement('div');
    el.className = 'saved-item';

    el.innerHTML = `
      <div class="tab-favicon-placeholder"><span>${escapeHtml(getInitial(site.url))}</span></div>
      <span class="saved-title">${escapeHtml(site.title)}</span>
      <button class="saved-remove" data-id="${site.id}">
        ${renderIcon(PiX, 10)}
      </button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.saved-remove')) {
        removeSaved(site.id);
      } else {
        createTab(site.url);
      }
    });

    savedList.appendChild(el);
  });
}

export function saveCurrent() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab || !tab.url) return;

  if (state.saved.some((s) => s.url === tab.url)) return;

  const site = {
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
  };

  window.portal.createSaved({
    url: site.url,
    title: site.title,
    favicon: site.favicon || null,
    position: state.saved.length,
  }).then(() => {
    // Re-fetch from DB to get the auto-generated id
    return window.portal.getAllSaved();
  }).then((rows) => {
    state.saved = rows;
    renderSaved();
  });
}

function removeSaved(id) {
  window.portal.deleteSaved(id).then(() => {
    state.saved = state.saved.filter((s) => s.id !== id);
    renderSaved();
  });
}
