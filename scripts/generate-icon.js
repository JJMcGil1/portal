#!/usr/bin/env node
/**
 * Generates icon.icns from the app-icon.html SVG.
 * Uses Electron to render the SVG, then sips + iconutil to build .icns.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ICONSET_DIR = '/tmp/portal.iconset';
const ICNS_OUTPUT = path.join(__dirname, '..', 'src', 'icons', 'icon.icns');

const ICON_SPECS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    // Clean/create iconset dir
    if (fs.existsSync(ICONSET_DIR)) {
      fs.rmSync(ICONSET_DIR, { recursive: true });
    }
    fs.mkdirSync(ICONSET_DIR);

    // Render at 1024x1024 (largest needed)
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true }
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'icons', 'app-icon.html'));

    // Wait for render
    await new Promise(r => setTimeout(r, 500));

    // Capture at 1024x1024
    const image = await win.webContents.capturePage();
    const pngBuffer = image.toPNG();
    const masterPng = '/tmp/portal-icon-1024.png';
    fs.writeFileSync(masterPng, pngBuffer);
    win.destroy();

    console.log('Captured 1024x1024 master icon');

    // Generate all sizes using sips
    for (const [name, size] of ICON_SPECS) {
      const outPath = path.join(ICONSET_DIR, name);
      execSync(`sips -z ${size} ${size} "${masterPng}" --out "${outPath}" 2>/dev/null`);
      console.log(`  ${name} (${size}x${size})`);
    }

    // Build .icns
    execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_OUTPUT}"`);
    console.log(`\nGenerated: ${ICNS_OUTPUT}`);

    // Cleanup
    fs.rmSync(ICONSET_DIR, { recursive: true });
    fs.unlinkSync(masterPng);

    app.quit();
  } catch (err) {
    console.error('Error:', err);
    app.exit(1);
  }
});
