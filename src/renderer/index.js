// Portal — Renderer entry point
import {
  PiMagnifyingGlass,
  PiBookmarkSimple,
  PiCaretLeft,
  PiCaretRight,
  PiArrowClockwise,
  PiCode,
  PiSun,
  PiMoon,
  PiPlus,
} from 'react-icons/pi';
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc';
import { MdOutlineTab } from 'react-icons/md';
import { renderIcon } from './icon.js';
import { state, setTabIdCounter } from './state.js';
import { renderSaved } from './saved.js';
import { restoreTab, activateTab, renderTabs, createTab, createNewTab, navigateTab, setupTabContextMenu, setupBoundsTracking, setupTabViewEvents } from './tabs.js';
import { setupEvents } from './events.js';
import { setupSidebar } from './sidebar.js';
import { setupFloatingSidebar } from './floating-sidebar.js';
import { setupAccount } from './account.js';
import { loadTheme } from './theme.js';
import { normalizeUrl } from './utils.js';
import { setupUpdateToast } from './update-toast.js';
import { setupAbout } from './about.js';

function initStaticIcons() {
  // Titlebar icons
  document.getElementById('sidebar-collapse-btn').innerHTML = renderIcon(VscLayoutSidebarLeft);
  document.querySelector('.url-input-icon').innerHTML = renderIcon(PiMagnifyingGlass, 13);
  document.querySelector('.welcome-search-icon').innerHTML = renderIcon(PiMagnifyingGlass, 18);
  document.getElementById('back-btn').innerHTML = renderIcon(PiCaretLeft);
  document.getElementById('forward-btn').innerHTML = renderIcon(PiCaretRight);
  document.getElementById('reload-btn').innerHTML = renderIcon(PiArrowClockwise, 14);
  document.getElementById('devtools-btn').innerHTML = renderIcon(PiCode);
  document.querySelector('.theme-icon-sun').innerHTML = renderIcon(PiSun);
  document.querySelector('.theme-icon-moon').innerHTML = renderIcon(PiMoon);

  // Sidebar icons
  document.querySelector('#save-site-btn').innerHTML = renderIcon(PiBookmarkSimple, 14);
  document.querySelector('#new-tab-btn').innerHTML = renderIcon(PiPlus, 14);

  // Trigger icon
  document.querySelector('.sidebar-trigger-icon').innerHTML = renderIcon(VscLayoutSidebarLeftOff, 18);
}

function initWelcome() {
  // Time-based greeting
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour >= 5 && hour < 12) greeting = 'Good morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
  const el = document.getElementById('welcome-greeting');
  if (el) el.textContent = greeting;

  // Welcome search input — navigate on Enter
  const welcomeSearchInput = document.getElementById('welcome-search-input');
  if (welcomeSearchInput) {
    welcomeSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = normalizeUrl(welcomeSearchInput.value);
        if (!url) return;
        const activeTab = state.activeTabId ? state.tabs.find((t) => t.id === state.activeTabId) : null;
        if (activeTab && activeTab.url === '') {
          navigateTab(activeTab.id, url);
        } else {
          createTab(url);
        }
        welcomeSearchInput.value = '';
        welcomeSearchInput.blur();
      }
    });
  }

  // Shortcut tile clicks → navigate active new tab, or create one
  document.querySelectorAll('.shortcut-tile[data-url]').forEach((tile) => {
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      const url = tile.getAttribute('data-url');
      const activeTab = state.activeTabId ? state.tabs.find((t) => t.id === state.activeTabId) : null;
      if (activeTab && activeTab.url === '') {
        // Navigate the current New Tab in place
        navigateTab(activeTab.id, url);
      } else {
        createTab(url);
      }
    });
  });
}

async function init() {
  initStaticIcons();
  initWelcome();

  // Load saved sites from SQLite
  const savedRows = await window.portal.getAllSaved();
  state.saved = savedRows || [];
  renderSaved();

  // Load tabs from SQLite
  const tabRows = await window.portal.getAllTabs();
  const activeTabId = await window.portal.getActiveTabId();

  if (tabRows && tabRows.length > 0) {
    // Set the tab ID counter to be above the highest existing ID
    const nextId = await window.portal.getNextTabId();
    setTabIdCounter(nextId - 1);

    // Restore each tab
    tabRows.forEach((row) => restoreTab(row));

    // Activate the previously active tab, or the first one
    if (activeTabId && state.tabs.find((t) => t.id === activeTabId)) {
      activateTab(activeTabId);
    } else if (state.tabs.length > 0) {
      activateTab(state.tabs[0].id);
    }
  }

  renderTabs();
  setupBoundsTracking();
  setupTabViewEvents();
  setupEvents();
  setupSidebar();
  setupFloatingSidebar();
  setupTabContextMenu();
  await setupAccount();
  setupUpdateToast();
  await setupAbout();
}

loadTheme();
init();
