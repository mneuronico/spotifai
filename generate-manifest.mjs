// generate-manifest.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const albumsDir = path.join(root, 'albums');

function isDir(p){ try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p){ try { return fs.statSync(p).isFile(); } catch { return false; } }

function parseTrackBase(filename){
  // expects "NN - Title.ext"
  const m = filename.match(/^(\d{2}) - (.+)\.(mp3|png)$/i);
  if (!m) return null;
  return { num: parseInt(m[1],10), title: m[2], ext: m[3].toLowerCase(), base: `${m[1]} - ${m[2]}` };
}

function ffprobeDuration(filePath){
  try{
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, {stdio:['ignore','pipe','ignore']}).toString().trim();
    const sec = parseFloat(out);
    return Number.isFinite(sec) ? Math.round(sec) : null;
  }catch{
    return null;
  }
}

function tryGitAddedDate(folderAbs){
  // Returns YYYY-MM-DD or null
  try{
    // first commit date that introduced something under folder
    const out = execSync(`git log --diff-filter=A --format=%cs -- "${folderAbs}" | tail -n 1`, {stdio:['pipe','pipe','ignore']})
      .toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  }catch{
    return null;
  }
}

function readMeta(albumPath){
  let artist = null, date_released = null, date_added = null, recommended = false;

  const metaPath = path.join(albumPath, 'meta.json');
  if (isFile(metaPath)){
    try{
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (typeof meta.artist === 'string' && meta.artist.trim()) artist = meta.artist.trim();
      if (typeof meta.date_released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.date_released)) date_released = meta.date_released;
      if (typeof meta.date_added === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.date_added)) date_added = meta.date_added;
      if (typeof meta.recommended === 'boolean') recommended = meta.recommended;
    }catch(e){
      console.warn(`meta.json inválido en ${albumPath}:`, e.message);
    }
  }

  // fallback artist.txt
  if (!artist){
    const artistPath = path.join(albumPath, 'artist.txt');
    if (isFile(artistPath)) {
      artist = fs.readFileSync(artistPath, 'utf8').trim();
    }
  }

  // fallback date_added via git
  if (!date_added){
    date_added = tryGitAddedDate(albumPath);
  }

  return { artist: artist || null, date_released, date_added, recommended };
}

const albums = [];

if (!isDir(albumsDir)){
  console.error('No "albums" directory found. Create it and add your album folders.');
  process.exit(1);
}

for (const albumName of fs.readdirSync(albumsDir)){
  const albumPath = path.join(albumsDir, albumName);
  if (!isDir(albumPath)) continue;

  const files = fs.readdirSync(albumPath);
  const coverExists = files.includes('cover.png');

  const { artist, date_released, date_added, recommended } = readMeta(albumPath);

  const mp3s = files.filter(f => /\.mp3$/i.test(f));
  const pngs = new Set(files.filter(f => /\.png$/i.test(f)));

  const tracks = [];
  for (const mp3 of mp3s){
    const parsed = parseTrackBase(mp3);
    if (!parsed) continue;
    const base = parsed.base;
    const pngName = `${base}.png`;
    const pngExists = pngs.has(pngName);

    const number = parsed.num;
    const title = parsed.title;

    // try duration via ffprobe (optional)
    const duration = ffprobeDuration(path.join(albumPath, mp3));

    tracks.push({ number, title, base, pngExists, duration });
  }

  // sort by track number
  tracks.sort((a,b)=> a.number - b.number);

  albums.push({
    id: `albums/${albumName}`, // estable para mapear entre re-ordenamientos
    title: albumName,
    folder: `albums/${albumName}`,
    coverExists,
    artist: artist || null,
    date_released: date_released || null,
    date_added: date_added || null,
    recommended: !!recommended,
    tracks
  });
}

const manifest = { version: 2, generatedAt: new Date().toISOString(), albums };
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest.json with ${albums.length} album(s).`);
