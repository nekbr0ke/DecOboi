// Сборка сайта на Vercel: копирует index.html и фото в папку public
// и создаёт photos-manifest.json (список фото для каждой карточки).
const fs = require('fs');
const path = require('path');

const OUT = 'public';
const EXT = /\.(jpe?g|png|webp)$/i;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync('index.html', path.join(OUT, 'index.html'));

const manifest = {}; // "Бренд|артикул" -> [ {path, interior} ]

function addPhoto(rel) {
  const parts = rel.split('/');
  if (parts.length < 2) return;
  const brand = parts[0];
  const base = parts[parts.length - 1].replace(EXT, '');
  const interior = parts.some(x => /интерьер|interior/i.test(x)) || /interior/i.test(base);
  const cleaned = base
    .replace(/interior\s*image/i, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const articles = cleaned.split(/[,;+&\s]+/).filter(t => /\d/.test(t));
  for (const art of articles) {
    const key = brand + '|' + art;
    (manifest[key] = manifest[key] || []).push({ path: 'photos/' + rel, interior });
  }
}

function walk(dir, rel) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, r);
    else if (EXT.test(e.name)) {
      addPhoto(r);
      const dest = path.join(OUT, 'photos', r);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
    }
  }
}
walk('photos', '');

const result = {};
for (const [key, arr] of Object.entries(manifest)) {
  const seen = new Set();
  const sorted = arr
    .filter(x => !seen.has(x.path) && seen.add(x.path))
    .sort((a, b) => (a.interior - b.interior) || a.path.localeCompare(b.path, 'ru', { numeric: true }));
  result[key] = sorted.map(x => x.path);
}
fs.writeFileSync(path.join(OUT, 'photos-manifest.json'), JSON.stringify(result));
console.log('Фото привязано к артикулам:', Object.keys(result).length);
