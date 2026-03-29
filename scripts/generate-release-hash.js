const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const releaseDir = path.join(__dirname, '..', 'release');
const pkg = require(path.join(__dirname, '..', 'package.json'));
const version = pkg.version;

function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

// Find release artifacts
const files = fs.readdirSync(releaseDir).filter(f =>
  f.endsWith('.dmg') || (f.endsWith('.zip') && f.includes('mac'))
);

if (files.length === 0) {
  console.error('No release artifacts found in release/');
  process.exit(1);
}

const platforms = {};
const hashLines = [];

for (const file of files) {
  const filePath = path.join(releaseDir, file);
  const hash = sha256(filePath);
  const size = fileSize(filePath);

  hashLines.push(`${hash}  ${file}`);

  if (file.includes('arm64') && file.endsWith('.dmg')) {
    platforms['mac-arm64'] = { url: file, sha256: hash, size };
  } else if (file.includes('arm64') && file.endsWith('.zip')) {
    platforms['mac-arm64-zip'] = { url: file, sha256: hash, size };
  } else if (file.endsWith('.dmg')) {
    platforms['mac'] = { url: file, sha256: hash, size };
  } else if (file.endsWith('.zip')) {
    platforms['macZip'] = { url: file, sha256: hash, size };
  }
}

const latestJson = {
  version,
  releaseDate: new Date().toISOString(),
  releaseNotes: 'Bug fixes and improvements.',
  platforms,
};

fs.writeFileSync(
  path.join(releaseDir, 'latest.json'),
  JSON.stringify(latestJson, null, 2)
);

fs.writeFileSync(
  path.join(releaseDir, 'hashes.txt'),
  hashLines.join('\n') + '\n'
);

console.log(`Generated latest.json and hashes.txt for v${version}`);
console.log('Platforms:', Object.keys(platforms).join(', '));
hashLines.forEach(l => console.log(`  ${l}`));
