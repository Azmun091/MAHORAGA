/**
 * Generate PWA icons from SVG
 * Requires: npm install sharp
 * Run: node scripts/generate-icons.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, '..', 'public');
const iconSvg = path.join(publicDir, 'icon.svg');

if (!fs.existsSync(iconSvg)) {
  console.error(`ERROR: icon.svg not found at ${iconSvg}`);
  process.exit(1);
}

const sizes = [32, 72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  console.log(`Generating PWA icons from ${iconSvg}...\n`);

  // Generate regular icons
  for (const size of sizes) {
    const outputPath = path.join(publicDir, `icon-${size}.png`);
    try {
      await sharp(iconSvg)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 10, g: 12, b: 14, alpha: 1 }
        })
        .png()
        .toFile(outputPath);
      console.log(`  ✓ Created icon-${size}.png`);
    } catch (error) {
      console.error(`  ✗ Failed to create icon-${size}.png:`, error.message);
    }
  }

  // Generate maskable icon (512x512 with safe zone)
  const maskablePath = path.join(publicDir, 'icon-maskable.png');
  try {
    await sharp(iconSvg)
      .resize(384, 384, {
        fit: 'contain',
        background: { r: 10, g: 12, b: 14, alpha: 1 }
      })
      .extend({
        top: 64,
        bottom: 64,
        left: 64,
        right: 64,
        background: { r: 10, g: 12, b: 14, alpha: 1 }
      })
      .png()
      .toFile(maskablePath);
    console.log(`  ✓ Created icon-maskable.png`);
  } catch (error) {
    console.error(`  ✗ Failed to create icon-maskable.png:`, error.message);
  }

  console.log('\nIcon generation complete!');
  console.log(`All icons are in: ${publicDir}`);
}

generateIcons().catch(console.error);
