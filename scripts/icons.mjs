import sharp from 'sharp';
import { existsSync } from 'node:fs';
const original = process.argv[2];
const source = original && existsSync(original) ? original : 'public/icons/icon.svg';
for (const [name, size] of [
  ['icon-192', 192],
  ['icon-512', 512],
  ['apple-touch-icon', 180],
  ['maskable-512', 512],
]) {
  let image = sharp(source);
  if (name === 'maskable-512')
    image = image.resize(410, 410, { fit: 'contain', background: '#130323' }).extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: '#130323',
    });
  else image = image.resize(size, size, { fit: 'contain', background: '#130323' });
  await image.png().toFile(`public/icons/${name}.png`);
}
console.log(`Iconos generados desde ${source}`);
