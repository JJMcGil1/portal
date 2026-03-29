// Portal — About section: version display + check for updates button

let updateCheckState = 'idle'; // idle | checking | upToDate | updateAvailable
let checkTimeout = null;

export async function setupAbout() {
  const versionEl = document.getElementById('about-version');
  const btn = document.getElementById('about-check-update');
  if (!btn) return;

  // Display current version
  try {
    const version = await window.portal.updater.getVersion();
    if (versionEl) versionEl.textContent = `v${version}`;
  } catch {}

  btn.addEventListener('click', async () => {
    if (updateCheckState === 'checking') return;

    setState('checking');

    try {
      const result = await window.portal.updater.checkForUpdates();

      if (result && result.upToDate) {
        setState('upToDate');
      } else if (result && !result.upToDate) {
        setState('updateAvailable');
      } else if (result && result.error) {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  });

  // Listen for update-available from background poll
  window.portal.updater.onUpdateAvailable(() => {
    setState('updateAvailable');
  });

  window.portal.updater.onUpToDate(() => {
    if (updateCheckState === 'checking') {
      setState('upToDate');
    }
  });
}

function setState(state) {
  updateCheckState = state;
  const btn = document.getElementById('about-check-update');
  if (!btn) return;

  if (checkTimeout) {
    clearTimeout(checkTimeout);
    checkTimeout = null;
  }

  switch (state) {
    case 'idle':
      btn.innerHTML = 'Check for updates';
      btn.disabled = false;
      break;
    case 'checking':
      btn.innerHTML = '<span class="spinner"></span> Checking...';
      btn.disabled = true;
      // 15s timeout to prevent UI blocking
      checkTimeout = setTimeout(() => setState('idle'), 15000);
      break;
    case 'upToDate':
      btn.innerHTML = '<span class="checkmark">&#10003;</span> Up to date';
      btn.disabled = true;
      checkTimeout = setTimeout(() => setState('idle'), 5000);
      break;
    case 'updateAvailable':
      btn.innerHTML = 'Update found!';
      btn.disabled = false;
      break;
  }
}
