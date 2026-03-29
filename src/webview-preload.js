// Webview preload — Chrome browser spoofing.
//
// With contextIsolation: false, this runs in the page's main world BEFORE
// any page scripts execute. This lets us set window.chrome, override
// navigator.userAgentData, mock plugins, etc. so Google's detection
// scripts see a real Chrome browser.
//
// Based on puppeteer-extra-plugin-stealth evasion modules:
// https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth

(function() {
  'use strict';

  // --- Extract Chrome version from the user agent ---
  const ua = navigator.userAgent;
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const chromeVersion = chromeMatch ? chromeMatch[1] : '134.0.6998.205';
  const chromeMajor = chromeVersion.split('.')[0];

  // ==========================================================================
  // 1. window.chrome — Google checks for chrome.runtime, chrome.app, chrome.csi
  // ==========================================================================
  if (!window.chrome) {
    window.chrome = {};
  }

  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update',
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic',
      },
      PlatformArch: {
        ARM: 'arm', ARM64: 'arm64', MIPS: 'mips',
        MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64',
      },
      PlatformNaclArch: {
        ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64',
        X86_32: 'x86-32', X86_64: 'x86-64',
      },
      PlatformOs: {
        ANDROID: 'android', CROS: 'cros', LINUX: 'linux',
        MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win',
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update', THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available',
      },
      get id() { return undefined; },
      connect: function() {
        throw new TypeError(
          "Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): " +
          "chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument."
        );
      },
      sendMessage: function() {
        throw new TypeError(
          "Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function responseCallback): " +
          "chrome.runtime.sendMessage() called from a webpage must specify an Extension ID (string) for its first argument."
        );
      },
    };
  }

  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
      installState: function(callback) { if (callback) callback('not_installed'); },
      runningState: function() { return 'cannot_run'; },
    };
  }

  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        onloadT: Date.now(),
        startE: Date.now(),
        pageT: performance.now(),
        tran: 15,
      };
    };
  }

  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      const now = Date.now() / 1000;
      return {
        commitLoadTime: now,
        connectionInfo: 'h2',
        finishDocumentLoadTime: now,
        finishLoadTime: now,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: now,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: now - 0.16,
        startLoadTime: now,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }

  // ==========================================================================
  // 2. navigator.userAgentData — override brands to include "Google Chrome"
  // ==========================================================================
  // Electron's compiled Chromium reports brands as ["Chromium", "Electron", "Not-A.Brand"].
  // Google checks this and blocks if "Google Chrome" is missing.
  // We shadow the prototype getter with our own on the navigator instance.
  const fakeBrands = [
    { brand: 'Chromium', version: chromeMajor },
    { brand: 'Google Chrome', version: chromeMajor },
    { brand: 'Not-A.Brand', version: '99' },
  ];

  const fakeFullBrands = [
    { brand: 'Chromium', version: chromeVersion },
    { brand: 'Google Chrome', version: chromeVersion },
    { brand: 'Not-A.Brand', version: '99.0.0.0' },
  ];

  const fakeUAData = {
    brands: fakeBrands,
    mobile: false,
    platform: 'macOS',
    getHighEntropyValues: function(hints) {
      return Promise.resolve({
        brands: fakeBrands,
        fullVersionList: fakeFullBrands,
        mobile: false,
        platform: 'macOS',
        platformVersion: '15.3.0',
        architecture: 'arm',
        bitness: '64',
        model: '',
        uaFullVersion: chromeVersion,
      });
    },
    toJSON: function() {
      return { brands: fakeBrands, mobile: false, platform: 'macOS' };
    },
  };

  // Try to override on the instance first (shadows prototype getter)
  try {
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => fakeUAData,
      configurable: true,
    });
  } catch (e) {
    // If that fails, try on the prototype
    try {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        get: () => fakeUAData,
        configurable: true,
      });
    } catch (e2) {
      // Last resort: direct assignment
      navigator.userAgentData = fakeUAData;
    }
  }

  // ==========================================================================
  // 3. navigator.plugins — real Chrome has PDF plugins, Electron may not
  // ==========================================================================
  try {
    const fakePlugins = {
      0: { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      1: { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      2: { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      3: { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      4: { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      length: 5,
      item: function(i) { return this[i] || null; },
      namedItem: function(name) {
        for (let i = 0; i < this.length; i++) {
          if (this[i].name === name) return this[i];
        }
        return null;
      },
      refresh: function() {},
    };

    Object.defineProperty(navigator, 'plugins', {
      get: () => fakePlugins,
      configurable: true,
    });

    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => ({
        length: 2,
        0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        1: { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        item: function(i) { return this[i] || null; },
        namedItem: function(name) {
          for (let i = 0; i < this.length; i++) {
            if (this[i].type === name) return this[i];
          }
          return null;
        },
      }),
      configurable: true,
    });
  } catch (e) {}

  // ==========================================================================
  // 4. navigator.webdriver — must be false (puppeteers set it to true)
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch (e) {}

  // ==========================================================================
  // 5. navigator.languages — ensure it returns a proper array
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch (e) {}

  // ==========================================================================
  // 6. Clean up Node.js / Electron globals that leak into the page
  // ==========================================================================
  // With contextIsolation: false, Node globals may be visible.
  // Delete them so page scripts can't detect Electron.
  const nodeGlobals = ['process', 'require', 'module', 'Buffer', '__dirname', '__filename', 'global'];
  for (const name of nodeGlobals) {
    try {
      if (name in window) {
        delete window[name];
      }
    } catch (e) {
      try {
        Object.defineProperty(window, name, {
          get: () => undefined,
          configurable: true,
        });
      } catch (e2) {}
    }
  }

  // Also clean up the 'process' on globalThis
  try {
    if (typeof globalThis !== 'undefined' && globalThis.process) {
      delete globalThis.process;
    }
  } catch (e) {}

  // ==========================================================================
  // 7. Permissions API — Chrome returns "prompt" for notifications by default
  // ==========================================================================
  try {
    const origQuery = Permissions.prototype.query;
    Permissions.prototype.query = function(parameters) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return origQuery.call(this, parameters);
    };
  } catch (e) {}

  // ==========================================================================
  // 8. WebGL — ensure renderer/vendor don't say "SwiftShader" (headless signal)
  // ==========================================================================
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      // UNMASKED_VENDOR_WEBGL
      if (parameter === 37445) return 'Apple';
      // UNMASKED_RENDERER_WEBGL
      if (parameter === 37446) return 'Apple GPU';
      return getParameter.call(this, parameter);
    };
  } catch (e) {}

})();
