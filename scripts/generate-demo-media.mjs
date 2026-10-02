// Generates the fictional demo media in src/demo/assets (committed; rerun only
// to change them). Requires ffmpeg with libopus for the voice note.
//   node scripts/generate-demo-media.mjs
// Everything is drawn here: abstract avatars, two dark illustrations (bright
// panels light up an additive display) and a short synthesized tone melody.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/demo/assets');

const avatars = {
  // Maya Chen: two overlapping circles.
  maya: `<rect width="192" height="192" fill="#1d2a4a"/><circle cx="76" cy="84" r="52" fill="#5b7cfa" opacity=".9"/><circle cx="120" cy="112" r="46" fill="#36c2b4" opacity=".85"/>`,
  // Sam Rivera: stacked triangles.
  sam: `<rect width="192" height="192" fill="#3a2414"/><path d="M30 150 L96 40 L162 150 Z" fill="#f08a3c"/><path d="M62 150 L118 70 L170 150 Z" fill="#ffc46b" opacity=".85"/>`,
  // Hike Crew: mountain ridge and sun.
  hike: `<rect width="192" height="192" fill="#102a22"/><circle cx="138" cy="58" r="22" fill="#f2c94c"/><path d="M0 150 L58 76 L92 116 L128 64 L192 150 L192 192 L0 192 Z" fill="#3fa36b"/><path d="M0 170 L70 120 L120 160 L192 128 L192 192 L0 192 Z" fill="#23704a"/>`,
  // Library News: three book spines.
  library: `<rect width="192" height="192" fill="#2a2140"/><rect x="44" y="52" width="28" height="96" rx="4" fill="#c9a6ff"/><rect x="80" y="40" width="30" height="108" rx="4" fill="#8f7bff"/><rect x="118" y="60" width="26" height="88" rx="4" transform="rotate(12 131 104)" fill="#e2d4ff"/><rect x="36" y="148" width="120" height="8" rx="3" fill="#6d5ca8"/>`,
  // Bike Shop: a wheel.
  bikes: `<rect width="192" height="192" fill="#26262e"/><circle cx="96" cy="96" r="58" fill="none" stroke="#9fa8ff" stroke-width="12"/><circle cx="96" cy="96" r="10" fill="#9fa8ff"/>${[0, 30, 60, 90, 120, 150].map(a => `<line x1="96" y1="96" x2="${96 + 52 * Math.cos((a * Math.PI) / 180)}" y2="${96 + 52 * Math.sin((a * Math.PI) / 180)}" stroke="#9fa8ff" stroke-width="4" transform="rotate(0)"/><line x1="96" y1="96" x2="${96 - 52 * Math.cos((a * Math.PI) / 180)}" y2="${96 - 52 * Math.sin((a * Math.PI) / 180)}" stroke="#9fa8ff" stroke-width="4"/>`).join('')}`,
};

const sketch = `
<rect width="800" height="600" fill="#11161d"/>
<g fill="none" stroke="#8fd3ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="70" y="90" width="190" height="300" rx="22"/>
  <rect x="320" y="90" width="190" height="300" rx="22"/>
  <rect x="570" y="90" width="170" height="300" rx="22"/>
  <path d="M260 240 C285 230 295 230 318 240"/><path d="M306 230 L320 240 L306 252"/>
  <path d="M510 240 C535 230 545 230 568 240"/><path d="M556 230 L570 240 L556 252"/>
  <line x1="100" y1="150" x2="230" y2="150"/><line x1="100" y1="190" x2="200" y2="190"/>
  <rect x="350" y="130" width="130" height="50" rx="10"/><rect x="350" y="200" width="130" height="50" rx="10"/><rect x="350" y="270" width="130" height="50" rx="10"/>
  <circle cx="655" cy="170" r="38"/><line x1="600" y1="250" x2="710" y2="250"/><line x1="600" y1="290" x2="690" y2="290"/>
</g>
<g fill="#ffd66b" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold">
  <text x="105" y="455">Sign in</text><text x="365" y="455">Chats</text><text x="590" y="455">Profile</text>
</g>
<path d="M90 520 C250 500 520 540 720 505" fill="none" stroke="#ff8f8f" stroke-width="5" stroke-linecap="round"/>`;

const contours = Array.from({length: 7}, (_, i) =>
  `<ellipse cx="${470 + i * 6}" cy="${250 - i * 4}" rx="${330 - i * 44}" ry="${200 - i * 26}" transform="rotate(${-12 + i * 3} 470 250)"/>`).join('');
const trailMap = `
<rect width="800" height="600" fill="#0d1a14"/>
<g fill="none" stroke="#2f7d55" stroke-width="3" opacity=".9">${contours}</g>
<g fill="none" stroke="#2f7d55" stroke-width="3" opacity=".6"><ellipse cx="140" cy="470" rx="110" ry="70"/><ellipse cx="140" cy="470" rx="60" ry="36"/></g>
<path d="M90 560 C160 480 230 470 300 420 S420 330 470 300 S520 250 505 230" fill="none" stroke="#ff9a3c" stroke-width="8" stroke-dasharray="18 14" stroke-linecap="round"/>
<circle cx="90" cy="560" r="16" fill="#ff9a3c"/><circle cx="505" cy="230" r="16" fill="#ffd66b"/>
<g fill="#cfe9da" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold"><text x="120" y="575">P</text><text x="530" y="222">Summit</text></g>`;

async function svgTo(file, width, height, body, quality = 72) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  await sharp(Buffer.from(svg)).webp({quality}).toFile(path.join(out, file));
  console.log(`wrote ${file}`);
}

for (const [name, body] of Object.entries(avatars)) await svgTo(`avatar-${name}.webp`, 192, 192, body, 80);
await svgTo('photo-sketch.webp', 800, 600, sketch);
await svgTo('photo-trail-map.webp', 800, 600, trailMap);

// Six seconds of plucked tones (no voice), Opus in Ogg like Telegram voice notes.
// Commas are escaped for the filtergraph parser.
const melody = '0.25*sin(2*PI*t*(262*pow(2\\,(floor(mod(t*2\\,8))*2)/12)))*exp(-3*mod(t*2\\,1))';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=${melody}:s=48000:d=6`,
  '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', path.join(out, 'voice-note.ogg')]);
console.log('wrote voice-note.ogg');
