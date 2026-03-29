// Portal — Update Toast UI
// Renders at top-right corner. States: available, downloading, installing, error

let toastEl = null;
let currentState = null;
let updateVersion = '';
let downloadPercent = 0;
let errorMessage = '';

function getToast() {
  if (!toastEl) {
    toastEl = document.getElementById('update-toast');
  }
  return toastEl;
}

function show() {
  const el = getToast();
  if (el) {
    el.classList.add('visible');
  }
}

function hide() {
  const el = getToast();
  if (el) {
    el.classList.remove('visible');
  }
  currentState = null;
}

function render() {
  const el = getToast();
  if (!el) return;

  if (currentState === 'available') {
    el.innerHTML = `
      <div class="update-toast-content">
        <div class="update-toast-icon update-toast-icon-info">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM7.5 7h1v4h-1V7Z" fill="currentColor"/></svg>
        </div>
        <div class="update-toast-text">
          <span class="update-toast-title">Update available</span>
          <span class="update-toast-subtitle">Portal v${updateVersion} is ready</span>
        </div>
        <div class="update-toast-actions">
          <button class="update-toast-btn update-toast-btn-secondary" id="update-dismiss">Later</button>
          <button class="update-toast-btn update-toast-btn-primary" id="update-download">Download</button>
        </div>
      </div>
    `;
    el.querySelector('#update-dismiss').onclick = () => {
      hide();
      window.portal.updater.dismissUpdate();
    };
    el.querySelector('#update-download').onclick = () => {
      window.portal.updater.downloadUpdate();
    };
  } else if (currentState === 'downloading') {
    el.innerHTML = `
      <div class="update-toast-content">
        <div class="update-toast-icon update-toast-icon-spinner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" stroke-linecap="round"/></svg>
        </div>
        <div class="update-toast-text">
          <span class="update-toast-title">Downloading update...</span>
          <span class="update-toast-subtitle">${downloadPercent}%</span>
        </div>
        <div class="update-toast-progress">
          <div class="update-toast-progress-bar" style="width: ${downloadPercent}%"></div>
        </div>
      </div>
    `;
  } else if (currentState === 'installing') {
    el.innerHTML = `
      <div class="update-toast-content">
        <div class="update-toast-icon update-toast-icon-spinner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" stroke-linecap="round"/></svg>
        </div>
        <div class="update-toast-text">
          <span class="update-toast-title">Restarting Portal...</span>
        </div>
      </div>
    `;
  } else if (currentState === 'error') {
    el.innerHTML = `
      <div class="update-toast-content">
        <div class="update-toast-icon update-toast-icon-error">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.5 4.5h1v4.5h-1V4.5Zm.5 6a.625.625 0 1 1 0 1.25.625.625 0 0 1 0-1.25Z" fill="currentColor"/></svg>
        </div>
        <div class="update-toast-text">
          <span class="update-toast-title">Update failed</span>
          <span class="update-toast-subtitle">${errorMessage}</span>
        </div>
        <div class="update-toast-actions">
          <button class="update-toast-btn update-toast-btn-secondary" id="update-error-dismiss">Dismiss</button>
          <button class="update-toast-btn update-toast-btn-primary" id="update-error-retry">Retry</button>
        </div>
      </div>
    `;
    el.querySelector('#update-error-dismiss').onclick = () => hide();
    el.querySelector('#update-error-retry').onclick = () => {
      window.portal.updater.checkForUpdates();
    };
  }

  show();
}

export function setupUpdateToast() {
  const updater = window.portal.updater;

  updater.onUpdateAvailable((data) => {
    updateVersion = data.version;
    currentState = 'available';
    render();
  });

  updater.onDownloadProgress((data) => {
    downloadPercent = data.percent;
    currentState = 'downloading';
    render();
  });

  updater.onUpdateDownloaded(() => {
    currentState = 'installing';
    render();
  });

  updater.onInstalling(() => {
    currentState = 'installing';
    render();
  });

  updater.onUpdateError((data) => {
    errorMessage = data.message || 'Unknown error';
    currentState = 'error';
    render();
  });

  updater.onUpToDate(() => {
    // Don't show toast for up-to-date, handled in about section
  });
}
