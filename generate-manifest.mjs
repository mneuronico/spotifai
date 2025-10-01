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
    title: albumName,
    folder: `albums/${albumName}`,
    coverExists,
    tracks
  });
}

const manifest = { version: 1, generatedAt: new Date().toISOString(), albums };
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest.json with ${albums.length} album(s).`);
