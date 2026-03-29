// Sidebar collapse / overlay logic
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc';
import { appBody, sidebarCollapseBtn, sidebarTrigger, sidebar } from './dom.js';
import { renderIcon } from './icon.js';

let sidebarState = 'pinned';
let leaveTimer = null;

function setState(next) {
  const prev = sidebarState;
  sidebarState = next;
  appBody.classList.remove('sidebar-collapsed', 'sidebar-overlay');

  if (next === 'collapsed') {
    appBody.classList.add('sidebar-collapsed');
    sidebarCollapseBtn.innerHTML = renderIcon(VscLayoutSidebarLeftOff);
  } else if (next === 'overlay') {
    appBody.classList.add('sidebar-overlay');
    sidebarCollapseBtn.innerHTML = renderIcon(VscLayoutSidebarLeftOff);
  } else {
    // Pinning from overlay — transition from absolute to flow
    if (prev === 'overlay') {
      sidebar.style.position = 'absolute';
      requestAnimationFrame(() => {
        sidebar.style.position = '';
      });
    }
    sidebarCollapseBtn.innerHTML = renderIcon(VscLayoutSidebarLeft);
  }
}

export function setupSidebar() {
  sidebarCollapseBtn.addEventListener('click', () => {
    if (sidebarState === 'pinned') {
      setState('collapsed');
    } else {
      clearTimeout(leaveTimer);
      setState('pinned');
    }
  });

  sidebarTrigger.addEventListener('click', () => {
    if (sidebarState === 'collapsed' || sidebarState === 'overlay') {
      clearTimeout(leaveTimer);
      setState('pinned');
    }
  });

  sidebarTrigger.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimer);
    if (sidebarState === 'collapsed') {
      setState('overlay');
    }
  });

  sidebar.addEventListener('mouseenter', () => {
    if (sidebarState === 'overlay') {
      clearTimeout(leaveTimer);
    }
  });

  sidebar.addEventListener('mouseleave', (e) => {
    if (sidebarState === 'overlay') {
      const triggerRect = sidebarTrigger.getBoundingClientRect();
      if (e.clientX >= triggerRect.left && e.clientX <= triggerRect.right &&
          e.clientY >= triggerRect.top && e.clientY <= triggerRect.bottom) {
        return;
      }
      leaveTimer = setTimeout(() => {
        if (sidebarState === 'overlay') setState('collapsed');
      }, 300);
    }
  });

  sidebarTrigger.addEventListener('mouseleave', (e) => {
    if (sidebarState === 'overlay') {
      const rect = sidebar.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        return;
      }
      leaveTimer = setTimeout(() => {
        if (sidebarState === 'overlay') setState('collapsed');
      }, 300);
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      if (sidebarState === 'pinned') setState('collapsed');
      else setState('pinned');
    }
  });
}
