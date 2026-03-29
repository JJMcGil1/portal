// Floating Sidebar — Independent overlay panel
// Completely decoupled from main sidebar. Shows on hover when collapsed.
// Reparents sidebar-inner into a floating panel, returns it when hidden.

import { sidebar, sidebarTrigger } from './dom.js';

const floatingEl = document.getElementById('floating-sidebar');
const sidebarInner = sidebar.querySelector('.sidebar-inner');
let isVisible = false;
let leaveTimer = null;

function show() {
  if (isVisible) return;
  isVisible = true;
  clearTimeout(leaveTimer);

  // Move sidebar content into floating panel
  floatingEl.appendChild(sidebarInner);

  // Force reflow so the transition plays
  floatingEl.offsetHeight;
  floatingEl.classList.remove('closing');
  floatingEl.classList.add('visible');
}

function hide() {
  if (!isVisible) return;
  isVisible = false;

  floatingEl.classList.add('closing');
  floatingEl.classList.remove('visible');

  // After animation, move content back
  const onEnd = () => {
    floatingEl.removeEventListener('transitionend', onEnd);
    if (!isVisible) {
      sidebar.appendChild(sidebarInner);
      floatingEl.classList.remove('closing');
    }
  };
  floatingEl.addEventListener('transitionend', onEnd);

  // Fallback if transitionend doesn't fire
  setTimeout(() => {
    if (!isVisible) {
      sidebar.appendChild(sidebarInner);
      floatingEl.classList.remove('closing');
    }
  }, 300);
}

export function showFloatingSidebar() {
  show();
}

export function hideFloatingSidebar() {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    hide();
  }, 300);
}

export function isFloatingVisible() {
  return isVisible;
}

export function setupFloatingSidebar() {
  // Hover trigger → show
  sidebarTrigger.addEventListener('mouseenter', () => {
    show();
  });

  // Keep visible while mouse is over the floating panel
  floatingEl.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimer);
  });

  // Start hide timer when mouse leaves floating panel
  floatingEl.addEventListener('mouseleave', (e) => {
    // Don't hide if mouse moved to the trigger
    const triggerRect = sidebarTrigger.getBoundingClientRect();
    if (
      e.clientX >= triggerRect.left &&
      e.clientX <= triggerRect.right &&
      e.clientY >= triggerRect.top &&
      e.clientY <= triggerRect.bottom
    ) {
      return;
    }
    hideFloatingSidebar();
  });

  // Start hide timer when mouse leaves trigger
  sidebarTrigger.addEventListener('mouseleave', (e) => {
    // Don't hide if mouse moved to the floating panel
    const rect = floatingEl.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return;
    }
    hideFloatingSidebar();
  });
}
