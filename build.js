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
const THUMB_WIDTH = 640;   // ширина превью для каталога (WebP)
const FULL_WIDTH = 2400;   // максимальная ширина крупной версии
const CONCURRENCY = 4;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync('index.html', path.join(OUT, 'index.html'));

// Известные артикулы берём из таблицы товаров, зашитой в index.html:
// так номер находится в имени файла как угодно (35422_wall, 35422-rapport, Aura 35422 и т.д.)
const known = new Map(); // артикул в нижнем регистре -> артикул как в таблице
try {
  const html = fs.readFileSync('index.html', 'utf8');
  const raw = JSON.parse(html.match(/const RAW=(\{[\s\S]*?\});\n/)[1]);
  raw.r.forEach(r => { if (r[2]) { const a = r[2].split(/\s+/)[0]; known.set(a.toLowerCase(), a); } });
  console.log('Известных артикулов в таблице:', known.size);
} catch (e) { console.warn('Не удалось прочитать таблицу артикулов из index.html:', e.message); }

function findArticles(text) {
  const tokens = text.split(/[^A-Za-z0-9\u0400-\u04FF-]+/).filter(Boolean);
  const found = new Set();
  for (const tok of tokens) {
    let t = tok, hit = null;
    while (t) {                                  // 35422-rapport -> 35422
      if (known.has(t.toLowerCase())) { hit = known.get(t.toLowerCase()); break; }
      const cut = t.replace(/-[^-]*$/, '');
      if (cut === t) break;
      t = cut;
    }
    if (hit) found.add(hit);
  }
  if (!found.size) tokens.filter(t => /\d/.test(t)).forEach(t => found.add(t)); // запасной вариант
  return [...found];
}

const manifest = {};
const jobs = [];

function toJpg(rel) { return rel.replace(EXT, '.jpg'); }

function addPhoto(rel) {
  const parts = rel.split('/');
  
  const base = parts[parts.length - 1].replace(EXT, '');
  const interior = parts.some(x => /интерьер|interior/i.test(x)) || /interior/i.test(base);
  const cleaned = base.replace(/interior\s*image/i, ' ').replace(/\([^)]*\)/g, ' ');
  const rank = interior ? 3 : /rapport/i.test(base) ? 2 : /wall/i.test(base) ? 1 : 0; // обои, wall, rapport, интерьер
  for (const art of findArticles(cleaned)) {
    (manifest[art] = manifest[art] || []).push({ path: 'photos/' + toJpg(rel), rank });
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
  const thumbDest = path.join(OUT, 'photos-thumb', rel.replace(/\.jpg$/, '.webp'));
  fs.mkdirSync(path.dirname(fullDest), { recursive: true });
  fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
  try {
    if (!sharp) throw new Error('no sharp');
    // Оригинал читается один раз: сначала крупная версия, превью делается уже из неё (так быстрее)
    const fullBuf = await sharp(src, { failOn: 'none' }).rotate()
      .resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 84, progressive: true }).toBuffer();
    fs.writeFileSync(fullDest, fullBuf);
    await sharp(fullBuf).resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72, effort: 3 }).toFile(thumbDest);
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
      .sort((a, b) => (a.rank - b.rank) || a.path.localeCompare(b.path, 'ru', { numeric: true }))
      .map(x => x.path);
  }
  fs.writeFileSync(path.join(OUT, 'photos-manifest.json'), JSON.stringify(result));
  console.log('Фото обработано:', jobs.length, '| артикулов с фото:', Object.keys(result).length);
}
main().catch(e => { console.error(e); process.exit(1); });
