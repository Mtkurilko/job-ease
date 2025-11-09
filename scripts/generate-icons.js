/*
  Generates extension icons from public/full_icon.jpeg
  - Crops to a centered square
  - Resizes to 16, 32, 48, 128 px PNGs
*/
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function run() {
  const src = path.resolve(__dirname, '../public/full_icon.jpeg');
  if (!fs.existsSync(src)) {
    console.error('Source image not found at', src);
    process.exit(1);
  }
  const outDir = path.resolve(__dirname, '../public');
  const sizes = [16, 32, 48, 128];
  const image = sharp(src);
  const meta = await image.metadata();
  const side = Math.min(meta.width || 0, meta.height || 0);
  const left = Math.max(0, Math.floor(((meta.width || 0) - side) / 2));
  const top = Math.max(0, Math.floor(((meta.height || 0) - side) / 2));
  const square = image.extract({ left, top, width: side, height: side });
  for (const s of sizes) {
    const outPath = path.join(outDir, `icon${s}.png`);
    await square.resize(s, s).png({ compressionLevel: 9 }).toFile(outPath);
    console.log('Wrote', outPath);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
