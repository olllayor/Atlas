const sharp = require('/Users/ollayor/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const RADIUS = 226;
const OUTPUT_DIR = path.join(__dirname, 'build');

// Create iconset directory
const iconsetDir = path.join(OUTPUT_DIR, 'icon.iconset');
if (!fs.existsSync(iconsetDir)) {
  fs.mkdirSync(iconsetDir, { recursive: true });
}

async function createIcon() {
  // Background gradient layer (indigo)
  const bgBuffer = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 99, g: 102, b: 241, alpha: 1 }
    }
  }).png().toBuffer();

  // Create the main icon with rounded corners using SVG overlay
  const svgOverlay = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#6366f1"/>
          <stop offset="100%" style="stop-color:#4338ca"/>
        </linearGradient>
        <linearGradient id="bubble" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#ffffff"/>
          <stop offset="100%" style="stop-color:#f8fafc"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#1e1b4b" flood-opacity="0.3"/>
        </filter>
      </defs>
      
      <!-- Rounded square background -->
      <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="url(#bg)"/>
      
      <!-- Subtle top highlight -->
      <path d="M ${RADIUS} 0 L ${SIZE-RADIUS} 0 Q ${SIZE} 0 ${SIZE} ${RADIUS} L ${SIZE} ${SIZE/2} L 0 ${SIZE/2} L 0 ${RADIUS} Q 0 0 ${RADIUS} 0 Z" fill="white" opacity="0.08"/>
      
      <!-- Chat bubble -->
      <g filter="url(#shadow)">
        <path d="M260 340 
                 Q260 280 320 280 
                 L704 280 
                 Q764 280 764 340 
                 L764 580 
                 Q764 640 704 640 
                 L520 640 
                 L380 760 
                 L380 640 
                 L320 640 
                 Q260 640 260 580 
                 Z" 
              fill="url(#bubble)"/>
      </g>
      
      <!-- CC Text -->
      <text x="512" y="520" 
            font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" 
            font-size="180" 
            font-weight="800" 
            fill="#4338ca" 
            text-anchor="middle" 
            dominant-baseline="middle" 
            letter-spacing="-8">CC</text>
    </svg>
  `;

  const icon = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .png()
    .toBuffer();

  // Save the 1024px version
  await sharp(icon).toFile(path.join(OUTPUT_DIR, 'icon.png'));
  console.log('✓ Created icon.png (1024x1024)');

  // Generate all iconset sizes
  const sizes = [
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

  for (const { name, size } of sizes) {
    await sharp(icon)
      .resize(size, size, { kernel: 'lanczos3' })
      .toFile(path.join(iconsetDir, name));
    console.log(`✓ Created ${name} (${size}x${size})`);
  }

  console.log('\n✓ All icons generated successfully!');
  console.log(`\nNext step: Run 'iconutil -c icns ${iconsetDir} -o ${path.join(OUTPUT_DIR, 'icon.icns')}'`);
}

createIcon().catch(console.error);
