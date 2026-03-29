// Webview preload — runs BEFORE page scripts.
// Uses webFrame.executeJavaScript to inject into the MAIN world so
// Google and other sites see a real Chrome fingerprint.
const { webFrame } = require('electron');

const chromeMajor = process.versions.chrome.split('.')[0];
const chromeVersion = process.versions.chrome;

// This runs in the page's main world — not isolated context.
// It executes before any page-level <script> tags.
webFrame.executeJavaScript(`
  // --- Override navigator.userAgentData ---
  if (navigator.userAgentData) {
    Object.defineProperty(navigator, 'userAgentData', {
      value: {
        brands: [
          { brand: "Chromium", version: "${chromeMajor}" },
          { brand: "Google Chrome", version: "${chromeMajor}" },
          { brand: "Not-A.Brand", version: "99" }
        ],
        mobile: false,
        platform: "macOS",
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            brands: this.brands,
            mobile: false,
            platform: "macOS",
            platformVersion: "15.0.0",
            architecture: "arm",
            model: "",
            uaFullVersion: "${chromeVersion}",
            fullVersionList: [
              { brand: "Chromium", version: "${chromeVersion}" },
              { brand: "Google Chrome", version: "${chromeVersion}" },
              { brand: "Not-A.Brand", version: "99.0.0.0" }
            ]
          });
        }
      },
      configurable: false,
      writable: false
    });
  }

  // --- Fake window.chrome runtime ---
  // Google checks for window.chrome.runtime to verify it's a real Chrome browser
  if (!window.chrome) { window.chrome = {}; }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {} }; },
      sendMessage: function() {},
      onMessage: { addListener: function() {}, removeListener: function() {} },
      onConnect: { addListener: function() {}, removeListener: function() {} },
      id: undefined
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: "h2",
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: "Other",
        npnNegotiatedProtocol: "h2",
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      };
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now(), tran: 15 };
    };
  }

  // --- Remove webdriver flag ---
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // --- Fix plugins/mimeTypes to look like real Chrome ---
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "" }
    ]
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en']
  });
`);
