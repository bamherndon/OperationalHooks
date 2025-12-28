// scripts/make-zip.js
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const distDir = path.join(__dirname, '..', 'dist');
const outputPath = path.join(__dirname, '..', 'lambda.zip');

if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist. Did you run `npm run build`?');
  process.exit(1);
}

const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Created ${outputPath} (${archive.pointer()} total bytes)`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Put the contents of dist/ at the root of the ZIP
archive.directory(distDir, false);

archive.finalize();
