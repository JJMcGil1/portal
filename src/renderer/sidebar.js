// Sidebar collapse / pin logic
// Overlay behavior is handled entirely by floating-sidebar.js
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc';
import { appBody, sidebarCollapseBtn, sidebarTrigger, sidebar } from './dom.js';
import { renderIcon } from './icon.js';
import { hideFloatingSidebar, isFloatingVisible } from './floating-sidebar.js';

let sidebarState = 'pinned'; // pinned | collapsed

function setState(next) {
  if (sidebarState === next) return;
  sidebarState = next;

  if (next === 'pinned') {
    hideFloatingSidebar();
    appBody.classList.remove('sidebar-collapsed');
    sidebarCollapseBtn.innerHTML = renderIcon(VscLayoutSidebarLeft);
  } else {
    appBody.classList.add('sidebar-collapsed');
    sidebarCollapseBtn.innerHTML = renderIcon(VscLayoutSidebarLeftOff);
  }
}

export function getSidebarState() {
  return sidebarState;
}

export function setupSidebar() {
  // Toggle button: pin / collapse
  sidebarCollapseBtn.addEventListener('click', () => {
    if (sidebarState === 'pinned') {
      setState('collapsed');
    } else {
      setState('pinned');
    }
  });

  // Clicking the trigger re-pins
  sidebarTrigger.addEventListener('click', () => {
    if (sidebarState === 'collapsed') {
      setState('pinned');
    }
  });

  // Keyboard shortcut: Cmd+\
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      if (sidebarState === 'pinned') setState('collapsed');
      else setState('pinned');
    }
  });
}
