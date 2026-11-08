// Сборка сайта на Vercel:
//  1) копирует index.html в папку public;
//  2) из каждого фото в photos/ делает две версии:
//     - photos-thumb/ — лёгкая (для карточек в каталоге),
//     - photos/       — крупная, в хорошем качестве (для страницы товара и увеличения);
//  3) создаёт photos-manifest.json (какие фото относятся к какому артикулу).
const fs = require('fs');
const path = require('path');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp не найден — фото копируются без уменьшения'); }

const OUT = 'public';
const EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const THUMB_WIDTH = 700;   // ширина превью для каталога
const FULL_WIDTH = 2400;   // максимальная ширина крупной версии
const CONCURRENCY = 4;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync('index.html', path.join(OUT, 'index.html'));

const manifest = {};
const jobs = [];

function toJpg(rel) { return rel.replace(EXT, '.jpg'); }

function addPhoto(rel) {
  const parts = rel.split('/');
  if (parts.length < 2) return;
  const brand = parts[0];
  const base = parts[parts.length - 1].replace(EXT, '');
  const interior = parts.some(x => /интерьер|interior/i.test(x)) || /interior/i.test(base);
  const cleaned = base.replace(/interior\s*image/i, ' ').replace(/\([^)]*\)/g, ' ');
  const articles = cleaned.split(/[,;+&\s]+/).filter(t => /\d/.test(t));
  for (const art of articles) {
    const key = brand + '|' + art;
    (manifest[key] = manifest[key] || []).push({ path: 'photos/' + toJpg(rel), interior });
  }
}

function walk(dir, rel) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, r);
    else if (EXT.test(e.name)) { addPhoto(r); jobs.push({ src: full, rel: toJpg(r) }); }
  }
}
walk('photos', '');

async function processOne({ src, rel }) {
  const fullDest = path.join(OUT, 'photos', rel);
  const thumbDest = path.join(OUT, 'photos-thumb', rel);
  fs.mkdirSync(path.dirname(fullDest), { recursive: true });
  fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
  try {
    if (!sharp) throw new Error('no sharp');
    const base = () => sharp(src, { failOn: 'none' }).rotate();
    await base().resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true }).toFile(fullDest);
    await base().resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true }).toFile(thumbDest);
  } catch (err) {
    console.warn('Не удалось обработать', src, '-', err.message, '(копирую как есть)');
    fs.copyFileSync(src, fullDest);
    fs.copyFileSync(src, thumbDest);
  }
}

async function main() {
  let next = 0, done = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      await processOne(job);
      if (++done % 50 === 0) console.log(`Обработано фото: ${done}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const result = {};
  for (const [key, arr] of Object.entries(manifest)) {
    const seen = new Set();
    result[key] = arr
      .filter(x => !seen.has(x.path) && seen.add(x.path))
      .sort((a, b) => (a.interior - b.interior) || a.path.localeCompare(b.path, 'ru', { numeric: true }))
      .map(x => x.path);
  }
  fs.writeFileSync(path.join(OUT, 'photos-manifest.json'), JSON.stringify(result));
  console.log('Фото обработано:', jobs.length, '| артикулов с фото:', Object.keys(result).length);
}
main().catch(e => { console.error(e); process.exit(1); });
