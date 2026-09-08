const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE_ICON = path.join(__dirname, 'icon.png');
const BUILD_DIR = path.join(__dirname, 'build');
const RUNTIME_ICON = path.join(BUILD_DIR, 'icon.png');
const ICNS_ICON = path.join(BUILD_DIR, 'icon.icns');

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

function assertSips() {
  try {
    execFileSync('sips', ['-g', 'all', '--help'], { stdio: 'ignore' });
  } catch {
    throw new Error('sips is required. This script requires macOS. Install Xcode Command Line Tools and rerun `node generate-icon.cjs`.');
  }
}

function resizePng(sourcePath, size, outputPath) {
  execFileSync(
    'sips',
    ['-z', String(size), String(size), sourcePath, '--out', outputPath],
    { stdio: 'ignore' }
  );
}

function resolveAppBuilderPath() {
  const electronBuilderDir = path.dirname(require.resolve('electron-builder/package.json'));
  const appBuilderBin = require(require.resolve('app-builder-bin', { paths: [electronBuilderDir] }));

  if (!appBuilderBin?.appBuilderPath) {
    throw new Error('Unable to resolve app-builder-bin from electron-builder.');
  }

  return appBuilderBin.appBuilderPath;
}

function createIcns(sourcePath) {
  const appBuilderPath = resolveAppBuilderPath();
  const rawResult = execFileSync(
    appBuilderPath,
    [
      'icon',
      '--format',
      'icns',
      '--root',
      BUILD_DIR,
      '--root',
      __dirname,
      '--input',
      sourcePath,
      '--out',
      BUILD_DIR,
    ],
    { encoding: 'utf8' }
  );

  let result = {};
  if (rawResult.trim()) {
    try {
      result = JSON.parse(rawResult);
    } catch (error) {
      throw new Error(`app-builder returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!fs.existsSync(ICNS_ICON)) {
    throw new Error(`ICNS icon was not created at ${ICNS_ICON}. Result: ${rawResult.trim() || '<empty>'}`);
  }

  return result;
}

function main() {
  if (!fs.existsSync(SOURCE_ICON)) {
    // CI checks out the tag without the designer's root source: reuse the
    // committed outputs instead of failing the package step.
    if (fs.existsSync(RUNTIME_ICON) && fs.existsSync(ICNS_ICON)) {
      console.log('Source icon.png not found; reusing committed build/icon.png and build/icon.icns.');
      return;
    }
    throw new Error(`Source icon not found: ${SOURCE_ICON}`);
  }

  assertSips();

  const { width, height } = readPngDimensions(SOURCE_ICON);
  if (width !== height) {
    throw new Error(`Source icon must be square. Received ${width}x${height}.`);
  }

  if (width < 1024 || height < 1024) {
    throw new Error(`Source icon must be at least 1024x1024. Received ${width}x${height}.`);
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.rmSync(path.join(BUILD_DIR, 'icon.iconset'), { recursive: true, force: true });

  // Generate runtime PNG for dev/runtime icon loading.
  resizePng(SOURCE_ICON, 1024, RUNTIME_ICON);
  console.log(`✓ Created ${path.relative(__dirname, RUNTIME_ICON)} (1024x1024)`);

  // Generate .icns using electron-builder's bundled app-builder. This is more
  // reliable than iconutil for web-exported PNG sources.
  createIcns(SOURCE_ICON);
  console.log(`✓ Created ${path.relative(__dirname, ICNS_ICON)}`);

  console.log('\n✓ All macOS icons generated successfully.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
