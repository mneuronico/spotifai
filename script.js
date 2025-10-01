/* global fetch */
const manifestUrl = 'manifest.json';

const els = {
  carousel: document.getElementById('albumCarousel'),
  albumTitle: document.getElementById('albumTitle'),
  trackList: document.getElementById('trackList'),
  nowCover: document.getElementById('nowCover'),
  nowSong: document.getElementById('nowSong'),
  nowAlbum: document.getElementById('nowAlbum'),
  audio: document.getElementById('audio'),
  btnPlayPause: document.getElementById('btnPlayPause'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnShuffle: document.getElementById('btnShuffle'),
  btnLoop: document.getElementById('btnLoop'),
  seek: document.getElementById('seek'),
  curTime: document.getElementById('curTime'),
  durTime: document.getElementById('durTime'),
  vol: document.getElementById('vol'),
  carouselPrev: document.getElementById('carouselPrev'),
  carouselNext: document.getElementById('carouselNext'),
};

let state = {
  albums: [],
  currentAlbumIdx: -1,
  currentTrackIdx: -1,
  shuffledIndices: null,
  isShuffle: false,
  isLoop: false,
};

function pad(n){return String(Math.floor(n)).padStart(2,'0');}
function fmtTime(sec){
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60), s = Math.round(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function encodePath(p){ return encodeURI(p).replace(/#/g, '%23'); }

function hashH(str){
  // simple 32-bit hash → hue 0..359
  let h=2166136261>>>0;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h)%360;
}
function makeInitials(name){
  return name.split(/\s+/).filter(Boolean).slice(0,3).map(w=>w[0].toUpperCase()).join('');
}
function makePlaceholderDataURL(title){
  const hue = hashH(title);
  const sat = 100, light = 45;
  const initials = makeInitials(title) || 'ALB';
  const c = document.createElement('canvas');
  c.width = 800; c.height = 800;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `hsl(${hue} ${sat}% ${light}%)`;
  ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 240px system-ui, -apple-system, Segoe UI, Inter, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, c.width/2, c.height/2);
  return c.toDataURL('image/png');
}

function trackCoverUrl(album, track){
  // prefer per-track PNG, else album cover, else placeholder
  if (track.pngExists) return encodePath(`${album.folder}/${track.base}.png`);
  if (album.coverExists) return encodePath(`${album.folder}/cover.png`);
  return makePlaceholderDataURL(album.title);
}

function albumCoverUrl(album){
  if (album.coverExists) return encodePath(`${album.folder}/cover.png`);
  return makePlaceholderDataURL(album.title);
}

function renderCarousel(){
  els.carousel.innerHTML = '';
  state.albums.forEach((alb, idx)=>{
    const card = document.createElement('button');
    card.className = 'carousel-card';
    card.setAttribute('aria-label', `Select album ${alb.title}`);
    card.addEventListener('click', ()=>selectAlbum(idx));
    card.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); selectAlbum(idx);} });
    const img = document.createElement('img');
    img.className = 'carousel-img';
    img.src = albumCoverUrl(alb);
    img.alt = `${alb.title} cover`;
    const title = document.createElement('div');
    title.className = 'carousel-title';
    title.textContent = alb.title;
    const sub = document.createElement('div');
    sub.className = 'carousel-sub';
    sub.textContent = `${alb.tracks.length} track${alb.tracks.length!==1?'s':''}`;
    card.append(img, title, sub);
    els.carousel.appendChild(card);
  });
}

function selectAlbum(idx){
  state.currentAlbumIdx = idx;
  const album = state.albums[idx];
  els.albumTitle.textContent = album.title;
  els.nowAlbum.textContent = album.title;
  els.trackList.innerHTML = '';

  album.tracks.forEach((t, tIdx)=>{
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = tIdx;
    li.addEventListener('click', ()=> playTrack(tIdx));

    const num = document.createElement('div'); num.className='num'; num.textContent = pad(t.number);
    const title = document.createElement('div'); title.className = 'title'; title.textContent = t.title;
    const dur = document.createElement('div'); dur.className='duration'; dur.textContent = t.duration? fmtTime(t.duration): '—';

    li.append(num, title, dur);
    els.trackList.appendChild(li);
  });

  // load first track visual (don’t autoplay)
  if (album.tracks.length){
    setNowPlaying(idx, 0, false);
  }
  // reset shuffle order for new album
  state.shuffledIndices = null;
}

function setNowPlaying(albumIdx, trackIdx, andPlay=true){
  state.currentAlbumIdx = albumIdx;
  state.currentTrackIdx = trackIdx;
  const album = state.albums[albumIdx];
  const track = album.tracks[trackIdx];

  els.nowSong.textContent = `${pad(track.number)} — ${track.title}`;
  els.nowAlbum.textContent = album.title;
  els.nowCover.src = trackCoverUrl(album, track);

  const src = encodePath(`${album.folder}/${track.base}.mp3`);
  if (els.audio.src !== (new URL(src, location.href)).href) {
    els.audio.src = src;
  }

  if (andPlay) els.audio.play().catch(()=>{ /* user gesture may be required */ });
  updatePlayIcon();
  highlightCurrentTrack();
}

function highlightCurrentTrack(){
  const items = els.trackList.querySelectorAll('.track');
  items.forEach(li => li.style.outline = '');
  const active = els.trackList.querySelector(`.track[data-index="${state.currentTrackIdx}"]`);
  if (active) active.style.outline = '2px solid var(--accent)';
}

function nextIndex(){
  const album = state.albums[state.currentAlbumIdx];
  if (!album) return 0;

  if (state.isShuffle){
    if (!state.shuffledIndices){
      state.shuffledIndices = [...album.tracks.keys()];
      for (let i=state.shuffledIndices.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [state.shuffledIndices[i], state.shuffledIndices[j]] = [state.shuffledIndices[j], state.shuffledIndices[i]];
      }
    }
    const pos = state.shuffledIndices.indexOf(state.currentTrackIdx);
    const nextPos = (pos+1) % state.shuffledIndices.length;
    return state.shuffledIndices[nextPos];
  }

  return (state.currentTrackIdx + 1) % album.tracks.length;
}

function prevIndex(){
  const album = state.albums[state.currentAlbumIdx];
  if (!album) return 0;

  if (state.isShuffle && state.shuffledIndices){
    const pos = state.shuffledIndices.indexOf(state.currentTrackIdx);
    const prevPos = (pos-1+state.shuffledIndices.length) % state.shuffledIndices.length;
    return state.shuffledIndices[prevPos];
  }

  return (state.currentTrackIdx - 1 + album.tracks.length) % album.tracks.length;
}

function playTrack(idx){ setNowPlaying(state.currentAlbumIdx, idx, true); }
function playNext(){ setNowPlaying(state.currentAlbumIdx, nextIndex(), true); }
function playPrev(){ setNowPlaying(state.currentAlbumIdx, prevIndex(), true); }

function updatePlayIcon(){
  const playing = !els.audio.paused;
  els.iconPlay.style.display = playing ? 'none' : '';
  els.iconPause.style.display = playing ? '' : 'none';
}

function attachEvents(){
  els.btnPlayPause.addEventListener('click', ()=>{
    if (els.audio.paused) els.audio.play().catch(()=>{});
    else els.audio.pause();
  });
  els.audio.addEventListener('play', updatePlayIcon);
  els.audio.addEventListener('pause', updatePlayIcon);

  els.btnNext.addEventListener('click', playNext);
  els.btnPrev.addEventListener('click', playPrev);

  els.btnShuffle.addEventListener('click', ()=>{
    state.isShuffle = !state.isShuffle;
    els.btnShuffle.setAttribute('aria-pressed', String(state.isShuffle));
    if (state.isShuffle) state.shuffledIndices = null; // reset order on toggle
  });

  els.btnLoop.addEventListener('click', ()=>{
    state.isLoop = !state.isLoop;
    els.btnLoop.setAttribute('aria-pressed', String(state.isLoop));
  });

  els.audio.addEventListener('timeupdate', ()=>{
    const p = (els.audio.currentTime / (els.audio.duration || 1)) * 100;
    els.seek.value = isFinite(p) ? p : 0;
    els.curTime.textContent = fmtTime(els.audio.currentTime);
    els.durTime.textContent = fmtTime(els.audio.duration);
  });
  els.seek.addEventListener('input', ()=>{
    const t = (parseFloat(els.seek.value)/100) * (els.audio.duration || 0);
    if (isFinite(t)) els.audio.currentTime = t;
  });

  els.vol.addEventListener('input', ()=>{ els.audio.volume = parseFloat(els.vol.value); });

  els.audio.addEventListener('ended', ()=>{
    if (state.isLoop) { els.audio.currentTime = 0; els.audio.play().catch(()=>{}); return; }
    playNext();
  });

  // carousel buttons
  els.carouselPrev.addEventListener('click', ()=> els.carousel.scrollBy({left:-400, behavior:'smooth'}));
  els.carouselNext.addEventListener('click', ()=> els.carousel.scrollBy({left:400, behavior:'smooth'}));
}

async function loadManifest(){
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error('manifest.json not found. run the generator.');
  const data = await res.json();
  // normalize
  state.albums = (data.albums || []).map(a => ({
    title: a.title,
    folder: a.folder,
    coverExists: !!a.coverExists,
    tracks: a.tracks.map(t=>({
      number: t.number,
      title: t.title,
      base: t.base,
      pngExists: !!t.pngExists,
      duration: t.duration ?? null,
    })),
  }));
}

(async function init(){
  try{
    attachEvents();
    await loadManifest();
    renderCarousel();

    // Auto-select first album if available
    if (state.albums.length) selectAlbum(0);
  }catch(err){
    console.error(err);
    document.querySelector('.content').innerHTML = `
      <div class="tracks-panel">
        <h2>Setup needed</h2>
        <p>Couldn’t find <code>manifest.json</code>. Please run <code>node generate-manifest.mjs</code> locally and commit the generated file.</p>
      </div>`;
  }
})();
