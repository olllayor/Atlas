const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE_ICON = path.join(__dirname, 'icon.png');
const BUILD_DIR = path.join(__dirname, 'build');
const ICONSET_DIR = path.join(BUILD_DIR, 'icon.iconset');
const RUNTIME_ICON = path.join(BUILD_DIR, 'icon.png');
const ICNS_ICON = path.join(BUILD_DIR, 'icon.icns');

const ICONSET_SIZES = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

function readPngDimensions(filePath) {
  const handle = fs.openSync(filePath, 'r');

  try {
    const header = Buffer.alloc(24);
    fs.readSync(handle, header, 0, header.length, 0);

    const isPng = header.toString('ascii', 1, 4) === 'PNG';
    if (!isPng) {
      throw new Error(`Source icon must be a PNG file: ${filePath}`);
    }

    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20)
    };
  } finally {
    fs.closeSync(handle);
  }
}

function assertImageMagick() {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('ImageMagick is required. Install `magick` and rerun `node generate-icon.cjs`.');
  }
}

function resizePng(sourcePath, size, outputPath) {
  execFileSync(
    'magick',
    [sourcePath, '-filter', 'Lanczos', '-resize', `${size}x${size}`, '-background', 'none', '-alpha', 'on', `PNG32:${outputPath}`],
    { stdio: 'inherit' }
  );
}

function main() {
  if (!fs.existsSync(SOURCE_ICON)) {
    throw new Error(`Source icon not found: ${SOURCE_ICON}`);
  }

  assertImageMagick();

  const { width, height } = readPngDimensions(SOURCE_ICON);
  if (width !== height) {
    throw new Error(`Source icon must be square. Received ${width}x${height}.`);
  }

  if (width < 1024 || height < 1024) {
    throw new Error(`Source icon must be at least 1024x1024. Received ${width}x${height}.`);
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // Generate runtime icon (1024x1024)
  resizePng(SOURCE_ICON, 1024, RUNTIME_ICON);
  console.log(`✓ Created ${path.relative(__dirname, RUNTIME_ICON)} (1024x1024)`);

  // Generate iconset
  if (fs.existsSync(ICONSET_DIR)) {
    fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(ICONSET_DIR, { recursive: true });

  for (const { name, size } of ICONSET_SIZES) {
    const outputPath = path.join(ICONSET_DIR, name);
    resizePng(SOURCE_ICON, size, outputPath);
    console.log(`✓ Created iconset/${name} (${size}x${size})`);
  }

  // Generate .icns from iconset
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', ICNS_ICON], { stdio: 'inherit' });
  console.log(`✓ Created ${path.relative(__dirname, ICNS_ICON)}`);

  // Clean up iconset directory
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });

  console.log('\n✓ All macOS icons generated successfully.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
