// Renders the monochrome app icon (white glyph on a transparent background,
// as the Meta docs recommend for glasses icons) into public/icon-*.png.
// Usage: npm run icons
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Speech bubble with a tail and a paper-plane cutout (a generic "send" glyph).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path fill="#ffffff" fill-rule="evenodd" d="
    M256 64c-114.9 0-208 80.6-208 180 0 53.3 26.8 101.2 69.4 134.1L96 448l86.9-37.6
    c22.9 7.6 47.6 11.6 73.1 11.6 114.9 0 208-80.6 208-180S370.9 64 256 64z
    M142 236l218-86-36 196-74-46-30 44v-62l96-82-118 70z"/>
</svg>`;

for (const size of [192, 512]) {
  const out = path.join(root, 'public', `icon-${size}.png`);
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`icon: ${path.relative(root, out)}`);
}
