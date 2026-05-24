/* global fetch */
const manifestUrl = 'manifest.json';
const defaultDocumentTitle = document.title || 'SpotifAI';

const els = {
  carousel: document.getElementById('albumCarousel'),
  carouselPrev: document.getElementById('carouselPrev'),
  carouselNext: document.getElementById('carouselNext'),
  albumTitle: document.getElementById('albumTitle'),
  trackList: document.getElementById('trackList'),
  nowCover: document.getElementById('nowCover'),
  nowSong: document.getElementById('nowSong'),
  nowAlbum: document.getElementById('nowAlbum'),
  audio: document.getElementById('audio'),
  btnPlayPause: document.getElementById('btnPlayPause'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  iconBuffering: document.getElementById('iconBuffering'),
  toast: document.getElementById('toast'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnShuffle: document.getElementById('btnShuffle'),
  btnLoop: document.getElementById('btnLoop'),
  seek: document.getElementById('seek'),
  curTime: document.getElementById('curTime'),
  durTime: document.getElementById('durTime'),
  vol: document.getElementById('vol'),
  sortMode: document.getElementById('sortMode'),
  playAlbumBtn: document.getElementById('playAlbumBtn'),
  albumRelease: document.getElementById('albumRelease'),
  albumArtist: document.getElementById('albumArtist'),
  surpriseBtn: document.getElementById('surpriseBtn'),
};

let state = {
  albums: [],
  selectedAlbumIdx: -1,
  playingAlbumIdx: -1,
  playingTrackIdx: -1,
  shuffledIndices: null,
  isShuffle: false,
  repeatMode: 'off',          // 'off' | 'all' | 'one' — default 'off' = paramos al final de la biblioteca (igual que Spotify/Apple Music)
  isBuffering: false,         // true durante stalls/`waiting`, oculta el play/pause y muestra spinner
  isSeeking: false,           // true mientras el usuario arrastra el seek slider; suprime el writeback de timeupdate
  sortMode: 'recommended_first',
  today: new Date(),
  globalQueue: null,
  globalQueuePos: -1,
};

// === Toast ===
let toastTimer = null;
function showToast(msg, durationMs = 2400){
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.hidden = false;
  // Force reflow para que la transición arranque
  void els.toast.offsetWidth;
  els.toast.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => { els.toast.hidden = true; }, 220);
  }, durationMs);
}

function updateDocumentTitle(track, album){
  if (track && album){
    document.title = `${track.title} - ${album.title} - spotifAI`;
  } else {
    document.title = defaultDocumentTitle;
  }
}

function pad(n){return String(Math.floor(n)).padStart(2,'0');}
function fmtTime(sec){
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60), s = Math.round(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function encodePath(p){ return encodeURI(p).replace(/#/g, '%23'); }

// --- URL & Slug helpers ---
function slugify(str){
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                     // separadores
    .replace(/^-+|-+$/g, '');                        // bordes
}
function albumSlug(album){ return slugify(album.title); }

function getAlbumSlugFromUrl(){
  try{
    const u = new URL(location.href);
    return u.searchParams.get('album');
  }catch{ return null; }
}
function setAlbumSlugInUrl(slug, {replace=false} = {}){
  try{
    const u = new URL(location.href);
    if (slug) u.searchParams.set('album', slug);
    else u.searchParams.delete('album');
    const newUrl = u.pathname + u.search + u.hash;
    if (replace) history.replaceState({}, '', newUrl);
    else history.pushState({}, '', newUrl);
  }catch{}
}
function findAlbumIndexBySlug(slug){
  if (!slug) return -1;
  return state.albums.findIndex(a => albumSlug(a) === slug);
}

// Flag para evitar bucles cuando seleccionamos por popstate/URL
let suppressUrlUpdate = false;


function trackSlug(track){
  // 01 - Título → "01-titulo"
  return slugify(`${pad(track.number)} ${track.title}`);
}

function getTrackSlugFromUrl(){
  try{
    const u = new URL(location.href);
    return u.searchParams.get('track');
  }catch{ return null; }
}
function setTrackSlugInUrl(slug, {replace=false} = {}){
  try{
    const u = new URL(location.href);
    if (slug) u.searchParams.set('track', slug);
    else u.searchParams.delete('track');
    const newUrl = u.pathname + u.search + u.hash;
    if (replace) history.replaceState({}, '', newUrl);
    else history.pushState({}, '', newUrl);
  }catch{}
}
function clearTrackFromUrl({replace=false} = {}){
  setTrackSlugInUrl(null, {replace});
}



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

function parseDateYYYYMMDD(s){
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetweenUTC(a,b){
  const ms = (Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate()) -
              Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()));
  return Math.round(ms/86400000);
}

function isNewByDateAdded(date_added_str, today){
  const d = parseDateYYYYMMDD(date_added_str);
  if (!d) return false;
  const t = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const diff = Math.abs(daysBetweenUTC(d, t));
  return diff <= 14;
}


function isNothingPlaying(){
  // “nada sonando” = audio pausado y sin haber avanzado
  return els.audio.paused && (els.audio.currentTime === 0);
}

function startPlayingAt(albumIdx, trackIdx, options = {}){
  const queue = Array.isArray(options.queue) && options.queue.length ? options.queue : null;
  const queuePos = typeof options.queuePos === 'number' ? options.queuePos : -1;

  if (queue){
    state.globalQueue = queue;
    const len = queue.length;
    const normalized = ((queuePos % len) + len) % len;
    state.globalQueuePos = normalized;
  } else {
    state.globalQueue = null;
    state.globalQueuePos = -1;
  }

  const albumChanged = state.playingAlbumIdx !== albumIdx;
  state.playingAlbumIdx = albumIdx;
  state.playingTrackIdx = trackIdx;
  state.selectedAlbumIdx = (state.selectedAlbumIdx === -1 ? albumIdx : state.selectedAlbumIdx);
  if (albumChanged) state.shuffledIndices = null; // reset cuando arranca un nuevo álbum (no entre pistas del mismo álbum)

  const album = state.albums[albumIdx];
  const track = album.tracks[trackIdx];

  updateDocumentTitle(track, album);

  // UI: player
  const albumLabel = album.artist ? `${album.title} — ${album.artist}` : album.title;
  els.nowSong.textContent = `${pad(track.number)} — ${track.title}`;
  els.nowAlbum.textContent = albumLabel;
  els.nowCover.src = trackCoverUrl(album, track);

  const src = encodePath(`${album.folder}/${track.base}.mp3`);
  const abs = (new URL(src, location.href)).href;
  if (els.audio.src !== abs) els.audio.src = src;

  els.audio.play().catch(()=>{});
  updatePlayIcon();
  highlightCurrentTrack();
  updateCarouselIndicators();
  updateMediaSessionMetadata();
}

// === Media Session API ===
function updateMediaSessionMetadata(){
  if (!('mediaSession' in navigator)) return;
  const album = state.albums[state.playingAlbumIdx];
  const track = album && album.tracks[state.playingTrackIdx];
  if (!album || !track){
    try { navigator.mediaSession.metadata = null; } catch {}
    return;
  }
  try {
    const artworkUrl = trackCoverUrl(album, track);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '',
      artist: album.artist || '',
      album: album.title || '',
      artwork: [
        { src: artworkUrl, sizes: '512x512', type: 'image/png' },
        { src: artworkUrl, sizes: '256x256', type: 'image/png' },
        { src: artworkUrl, sizes: '128x128', type: 'image/png' },
      ],
    });
  } catch {}
}
function updateMediaSessionPlaybackState(){
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = els.audio.paused ? 'paused' : 'playing';
  } catch {}
}
function updateMediaSessionPosition(){
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  const d = els.audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: els.audio.playbackRate || 1,
      position: Math.min(Math.max(els.audio.currentTime, 0), d),
    });
  } catch {}
}
function setupMediaSessionHandlers(){
  if (!('mediaSession' in navigator)) return;
  const set = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  };
  set('play', () => { els.audio.play().catch(()=>{}); });
  set('pause', () => { els.audio.pause(); });
  set('nexttrack', () => { playNext(); });
  set('previoustrack', () => { playPrev(); });
  set('seekbackward', (e) => {
    const offset = (e && e.seekOffset) || 10;
    els.audio.currentTime = Math.max(0, els.audio.currentTime - offset);
  });
  set('seekforward', (e) => {
    const offset = (e && e.seekOffset) || 10;
    const d = els.audio.duration;
    els.audio.currentTime = Math.min(isFinite(d) ? d : els.audio.currentTime + offset, els.audio.currentTime + offset);
  });
  set('seekto', (e) => {
    if (!e || typeof e.seekTime !== 'number') return;
    if (e.fastSeek && 'fastSeek' in els.audio){
      els.audio.fastSeek(e.seekTime);
    } else {
      els.audio.currentTime = e.seekTime;
    }
  });
  set('stop', () => { els.audio.pause(); els.audio.currentTime = 0; });
}

function updateCarouselIndicators(){
  const cards = getCards();
  cards.forEach((card, idx)=>{
    card.classList.toggle('is-selected', idx === state.selectedAlbumIdx);
    card.classList.toggle('is-playing', idx === state.playingAlbumIdx);
  });
}


function renderCarousel(){
  els.carousel.innerHTML = '';
  state.albums.forEach((alb, idx)=>{
    const card = document.createElement('button');
    card.className = 'carousel-card';
    card.setAttribute('aria-label', `Select album ${alb.title}`);

    // Badges (NEW / Recommended)
    const badgesWrap = document.createElement('div');
    badgesWrap.className = 'badges';
    const newFlag = isNewByDateAdded(alb.date_added, state.today);
    if (newFlag){
      const b = document.createElement('span'); b.className='badge badge-new'; b.textContent='NUEVO';
      badgesWrap.appendChild(b);
    }
    if (alb.recommended){
      const b = document.createElement('span'); b.className='badge badge-rec'; b.textContent='Recomendado';
      badgesWrap.appendChild(b);
    }

    card.addEventListener('click', ()=>{
      selectAlbum(idx);
    });
    card.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectAlbum(idx);
      }
    });

    const img = document.createElement('img');
    img.className = 'carousel-img';
    img.src = albumCoverUrl(alb);
    img.alt = `${alb.title} cover`;

    const title = document.createElement('div');
    title.className = 'carousel-title';
    title.textContent = alb.title;

    const sub = document.createElement('div');
    sub.className = 'carousel-sub';
    const countTxt = `${alb.tracks.length} track${alb.tracks.length!==1?'s':''}`;
    const artistTxt = alb.artist ? `${countTxt} • ${alb.artist}` : countTxt;
    sub.textContent = artistTxt;

    card.append(badgesWrap, img, title, sub);
    els.carousel.appendChild(card);
  });
}


/* === NAVEGACIÓN ESTÁNDAR CON scroll-snap + scrollIntoView ===
   Usa rectángulos (viewport real) para decidir el card visible y moverse
   uno a la vez con soporte cross-browser.
*/
function getCards(){
  return [...els.carousel.querySelectorAll('.carousel-card')];
}

// índice del card cuyo borde izquierdo está más alineado con el borde izquierdo del carrusel
function getVisibleCardIndex(){
  const cRect = els.carousel.getBoundingClientRect();
  const cards = getCards();
  let best = 0, bestDelta = Infinity;
  for (let i = 0; i < cards.length; i++){
    const delta = Math.abs(cards[i].getBoundingClientRect().left - cRect.left);
    if (delta < bestDelta) { bestDelta = delta; best = i; }
  }
  return best;
}

function scrollToCard(index){
  const cards = getCards();
  if (!cards.length) return;
  const i = Math.max(0, Math.min(index, cards.length - 1));
  cards[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
}

function scrollToNextCard(){ scrollToCard(getVisibleCardIndex() + 1); }
function scrollToPrevCard(){ scrollToCard(getVisibleCardIndex() - 1); }

function scrollCarouselToStart(){
  if (!els.carousel) return;
  // forzamos al inicio sin animación
  els.carousel.scrollTo({ left: 0, top: 0, behavior: 'auto' });
}

/* === LISTENERS DE LAS FLECHAS ===
   Reemplazá las líneas que antes hacían scrollBy({left:±400,...})f
   por estas dos:
*/
function attachCarouselArrowHandlers(){
  els.carouselPrev.addEventListener('click', scrollToPrevCard);
  els.carouselNext.addEventListener('click', scrollToNextCard);
}

async function getAudioDurationFromUrl(url){
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    // Importante para evitar que algunos navegadores intenten “autoplay”
    a.addEventListener('loadedmetadata', () => {
      const d = Number.isFinite(a.duration) ? Math.round(a.duration) : null;
      resolve(d);
    });
    a.addEventListener('error', () => resolve(null));
  });
}

async function fillMissingDurationsForAlbum(albumIdx){
  const album = state.albums[albumIdx];
  if (!album) return;

  for (let tIdx = 0; tIdx < album.tracks.length; tIdx++){
    const track = album.tracks[tIdx];
    if (track.duration != null) continue; // ya tenemos duración

    const src = encodePath(`${album.folder}/${track.base}.mp3`);
    const dur = await getAudioDurationFromUrl(src);
    if (dur != null){
      track.duration = dur;

      // Si el álbum seleccionado es este, actualizamos el DOM de esa fila
      if (state.selectedAlbumIdx === albumIdx){
        const li = els.trackList.querySelector(`.track[data-index="${tIdx}"] .duration`);
        if (li) li.textContent = fmtTime(dur);
      }
    }
  }
}


function selectAlbum(idx){
  state.selectedAlbumIdx = idx;
  const album = state.albums[idx];
  if (!album) return;

  // 1) Header existente en el DOM
  els.albumTitle.textContent = album.title || '—';
  els.albumArtist.textContent = album.artist || '—';
  els.albumRelease.textContent = album.date_released || '—';

  // Ocultar el separador si no hay fecha de lanzamiento
  const dot = document.querySelector('.album-meta .dot-sep');
  if (dot) dot.style.display = (album.date_released ? '' : 'none');

  // Botón "Play album" (NO crear otro, reutilizamos el existente)
  if (els.playAlbumBtn){
    els.playAlbumBtn.onclick = () => {
      // Si veníamos de compartir un track, limpiamos el param ?track
      clearTrackFromUrl({ replace: true });
      if (album.tracks.length > 0) startPlayingAt(idx, 0);
    };
  }

  // 2) Lista de pistas
  els.trackList.innerHTML = '';
  album.tracks.forEach((t, tIdx) => {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = tIdx;
    li.addEventListener('click', () => {
      startPlayingAt(idx, tIdx);                    // reproducir
      setTrackSlugInUrl(trackSlug(album.tracks[tIdx])); // poner ?track=...
    });
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = pad(t.number);

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title;

    const dur = document.createElement('div');
    dur.className = 'duration';
    dur.textContent = (typeof t.duration === 'number') ? fmtTime(t.duration) : '—';

    li.append(num, title, dur);
    els.trackList.appendChild(li);
  });

  // 3) If no hay nada sonando, precargar primer tema para "Now Playing"
  if (isNothingPlaying()) {
    const first = album.tracks[0];
    if (first) {
      const albumLabel = album.artist ? `${album.title} — ${album.artist}` : album.title;
      els.nowSong.textContent = `${pad(first.number)} — ${first.title}`;
      els.nowAlbum.textContent = albumLabel;
      els.nowCover.src = trackCoverUrl(album, first);

      const src = encodePath(`${album.folder}/${first.base}.mp3`);
      const abs = (new URL(src, location.href)).href;
      if (els.audio.src !== abs) els.audio.src = src;
    } else {
      els.nowAlbum.textContent = album.artist ? `${album.title} — ${album.artist}` : album.title;
      els.nowSong.textContent = '—';
      els.nowCover.src = albumCoverUrl(album);
    }
  } else {
    // no pisamos Now Playing; solo aseguramos que no quede vacío
    const albumLabel = album.artist ? `${album.title} — ${album.artist}` : album.title;
    els.nowAlbum.textContent = els.nowAlbum.textContent || albumLabel;
  }

  // 4) URL shareable
  if (!suppressUrlUpdate) {
    setAlbumSlugInUrl(albumSlug(album));
    clearTrackFromUrl({replace:true}); // al elegir álbum, sacamos 'track'
  }
  // 5) UI
  highlightCurrentTrack();
  updateCarouselIndicators();

  // 6) Fallback de duraciones
  if (typeof fillMissingDurationsForAlbum === 'function') fillMissingDurationsForAlbum(idx);
}




function highlightCurrentTrack(){
  // Sólo resaltamos en la lista del álbum seleccionado si coincide con el que suena
  const items = els.trackList.querySelectorAll('.track');
  items.forEach(li => li.style.outline = '');
  if (state.selectedAlbumIdx === state.playingAlbumIdx) {
    const active = els.trackList.querySelector(`.track[data-index="${state.playingTrackIdx}"]`);
    if (active) active.style.outline = '2px solid var(--accent)';
  }
}

function hasGlobalQueue(){
  return Array.isArray(state.globalQueue) && state.globalQueue.length > 0;
}

function playGlobalQueueAt(pos){
  if (!hasGlobalQueue()) return false;
  const len = state.globalQueue.length;
  if (!len) return false;
  const normalized = ((pos % len) + len) % len;
  const entry = state.globalQueue[normalized];
  if (!entry) return false;

  if (state.selectedAlbumIdx !== entry.albumIdx){
    const prev = suppressUrlUpdate;
    suppressUrlUpdate = true;
    selectAlbum(entry.albumIdx);
    suppressUrlUpdate = prev;
  }

  startPlayingAt(entry.albumIdx, entry.trackIdx, { queue: state.globalQueue, queuePos: normalized });
  const album = state.albums[entry.albumIdx];
  if (album) setAlbumSlugInUrl(albumSlug(album), {replace:true});
  const track = album?.tracks?.[entry.trackIdx];
  if (track) setTrackSlugInUrl(trackSlug(track), {replace:true});
  return true;
}

function playGlobalNext(){
  if (!hasGlobalQueue()) return false;
  const current = state.globalQueuePos >= 0 ? state.globalQueuePos : 0;
  return playGlobalQueueAt(current + 1);
}

function playGlobalPrev(){
  if (!hasGlobalQueue()) return false;
  const current = state.globalQueuePos >= 0 ? state.globalQueuePos : 0;
  return playGlobalQueueAt(current - 1);
}

function nextIndex(){
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return 0;

  if (state.isShuffle){
    if (!state.shuffledIndices){
      state.shuffledIndices = [...album.tracks.keys()];
      for (let i=state.shuffledIndices.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [state.shuffledIndices[i], state.shuffledIndices[j]] = [state.shuffledIndices[j], state.shuffledIndices[i]];
      }
    }
    const pos = state.shuffledIndices.indexOf(state.playingTrackIdx);
    const nextPos = (pos+1) % state.shuffledIndices.length;
    return state.shuffledIndices[nextPos];
  }

  return (state.playingTrackIdx + 1) % album.tracks.length;
}

function prevIndex(){
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return 0;

  if (state.isShuffle && state.shuffledIndices){
    const pos = state.shuffledIndices.indexOf(state.playingTrackIdx);
    const prevPos = (pos-1+state.shuffledIndices.length) % state.shuffledIndices.length;
    return state.shuffledIndices[prevPos];
  }

  return (state.playingTrackIdx - 1 + album.tracks.length) % album.tracks.length;
}

function playNext(){
  if (playGlobalNext()) return;
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return;
  // En modo no-shuffle, al final del álbum saltamos al siguiente álbum
  // (consistente con el auto-advance del evento `ended`)
  if (!state.isShuffle && state.playingTrackIdx === album.tracks.length - 1 && state.albums.length > 1) {
    const nextAlbum = (state.playingAlbumIdx + 1) % state.albums.length;
    startPlayingAt(nextAlbum, 0);
    return;
  }
  const nextIdx = nextIndex();
  startPlayingAt(state.playingAlbumIdx, nextIdx);
}

function playPrev(){
  if (playGlobalPrev()) return;
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return;
  // Simétrico a playNext: en el primer track, retrocedemos al último del álbum anterior
  if (!state.isShuffle && state.playingTrackIdx === 0 && state.albums.length > 1) {
    const prevAlbum = (state.playingAlbumIdx - 1 + state.albums.length) % state.albums.length;
    const lastIdx = state.albums[prevAlbum].tracks.length - 1;
    startPlayingAt(prevAlbum, Math.max(0, lastIdx));
    return;
  }
  const prevIdx = prevIndex();
  startPlayingAt(state.playingAlbumIdx, prevIdx);
}

// Avanza después de que terminó / falló la pista actual. Devuelve true si se inició algo.
// Respeta state.repeatMode: 'off' detiene al final de la cola/biblioteca; 'all' loopea como antes.
// repeat-'one' se maneja arriba en el handler `ended`, no acá.
function advanceAfterCurrent(){
  // Cola global (Sorpréndeme): si la cola se agotó y no hay repeat-all, parar.
  if (hasGlobalQueue()){
    const current = state.globalQueuePos >= 0 ? state.globalQueuePos : 0;
    const nextPos = current + 1;
    if (nextPos >= state.globalQueue.length && state.repeatMode !== 'all'){
      return false;
    }
    return playGlobalQueueAt(nextPos);
  }

  const album = state.albums[state.playingAlbumIdx];
  if (!album) return false;

  const isLastTrackNoShuffle = !state.isShuffle && (state.playingTrackIdx === album.tracks.length - 1);
  if (isLastTrackNoShuffle) {
    const isLastAlbum = state.playingAlbumIdx === state.albums.length - 1;
    if (isLastAlbum && state.repeatMode !== 'all'){
      return false; // fin de biblioteca, sin repeat
    }
    const nextAlbum = (state.playingAlbumIdx + 1) % state.albums.length;
    startPlayingAt(nextAlbum, 0);
    return true;
  }

  const nextIdx = nextIndex();
  startPlayingAt(state.playingAlbumIdx, nextIdx);
  return true;
}

// Contador de fallos consecutivos para no entrar en loop infinito si toda la cola está rota
let consecutivePlaybackErrors = 0;
const MAX_CONSECUTIVE_PLAYBACK_ERRORS = 4;


function updatePlayIcon(){
  if (state.isBuffering){
    els.iconPlay.style.display = 'none';
    els.iconPause.style.display = 'none';
    if (els.iconBuffering) els.iconBuffering.style.display = '';
    return;
  }
  if (els.iconBuffering) els.iconBuffering.style.display = 'none';
  const playing = !els.audio.paused;
  els.iconPlay.style.display = playing ? 'none' : '';
  els.iconPause.style.display = playing ? '' : 'none';
}

const REPEAT_MODES = ['off', 'all', 'one'];
const REPEAT_LABELS = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' };
function updateRepeatButton(){
  if (!els.btnLoop) return;
  els.btnLoop.setAttribute('data-repeat-mode', state.repeatMode);
  els.btnLoop.setAttribute('aria-pressed', String(state.repeatMode !== 'off'));
  els.btnLoop.setAttribute('title', REPEAT_LABELS[state.repeatMode] || 'Repeat');
}



function attachEvents(){
  els.btnPlayPause.addEventListener('click', ()=>{
    if (els.audio.paused) els.audio.play().catch(()=>{});
    else els.audio.pause();
  });
  els.audio.addEventListener('play', ()=>{ updatePlayIcon(); updateCarouselIndicators(); });
  els.audio.addEventListener('pause', ()=>{
    // Si el usuario pausa durante buffering, no nos quedamos con el spinner colgado
    state.isBuffering = false;
    updatePlayIcon();
    updateCarouselIndicators();
  });

  els.btnNext.addEventListener('click', playNext);
  els.btnPrev.addEventListener('click', playPrev);

  els.btnShuffle.addEventListener('click', ()=>{
    state.isShuffle = !state.isShuffle;
    els.btnShuffle.setAttribute('aria-pressed', String(state.isShuffle));
    if (state.isShuffle) state.shuffledIndices = null; // reset order on toggle
  });

  els.btnLoop.addEventListener('click', ()=>{
    const i = REPEAT_MODES.indexOf(state.repeatMode);
    state.repeatMode = REPEAT_MODES[(i + 1) % REPEAT_MODES.length];
    updateRepeatButton();
  });
  updateRepeatButton();

  if (els.surpriseBtn){
    els.surpriseBtn.addEventListener('click', ()=>{
      const queue = [];
      state.albums.forEach((album, albumIdx)=>{
        album.tracks.forEach((_, trackIdx)=>{
          queue.push({ albumIdx, trackIdx });
        });
      });
      if (!queue.length) return;

      for (let i = queue.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }

      const first = queue[0];
      if (typeof first.albumIdx !== 'number' || typeof first.trackIdx !== 'number') return;

      const prev = suppressUrlUpdate;
      suppressUrlUpdate = true;
      selectAlbum(first.albumIdx);
      suppressUrlUpdate = prev;

      startPlayingAt(first.albumIdx, first.trackIdx, { queue, queuePos: 0 });

      const album = state.albums[first.albumIdx];
      if (album) setAlbumSlugInUrl(albumSlug(album), {replace:true});
      const track = album?.tracks?.[first.trackIdx];
      if (track) setTrackSlugInUrl(trackSlug(track), {replace:true});
    });
  }

  els.audio.addEventListener('timeupdate', ()=>{
    // Mientras el usuario está arrastrando el slider, NO le pisamos su posición:
    // solo actualizamos los textos de tiempo y la posición del Media Session.
    if (!state.isSeeking){
      const p = (els.audio.currentTime / (els.audio.duration || 1)) * 100;
      els.seek.value = isFinite(p) ? p : 0;
    }
    els.curTime.textContent = fmtTime(els.audio.currentTime);
    els.durTime.textContent = fmtTime(els.audio.duration);
    updateMediaSessionPosition();
  });
  // Drag del seek: durante pointerdown→pointerup mantenemos isSeeking=true para
  // que `timeupdate` no nos pise; el `input` sigue siendo el que mueve el audio.
  const seekStart = () => { state.isSeeking = true; };
  const seekEnd = () => { state.isSeeking = false; };
  els.seek.addEventListener('pointerdown', seekStart);
  els.seek.addEventListener('pointerup', seekEnd);
  els.seek.addEventListener('pointercancel', seekEnd);
  // Fallback teclado: flechas izq/der disparan `change` al soltar el foco/cambiar valor.
  els.seek.addEventListener('keydown', seekStart);
  els.seek.addEventListener('keyup', seekEnd);
  els.seek.addEventListener('input', ()=>{
    const t = (parseFloat(els.seek.value)/100) * (els.audio.duration || 0);
    if (isFinite(t)) els.audio.currentTime = t;
  });

  els.vol.addEventListener('input', ()=>{ els.audio.volume = parseFloat(els.vol.value); });

  els.audio.addEventListener('ended', ()=>{
    if (state.repeatMode === 'one') {
      els.audio.currentTime = 0; els.audio.play().catch(()=>{});
      return;
    }
    const advanced = advanceAfterCurrent();
    if (!advanced){
      // Fin de biblioteca / cola sin repeat: paramos en seco.
      try { els.audio.pause(); } catch {}
      updateMediaSessionPlaybackState();
    }
  });

  // Si la pista falla al cargar (404, network, decode), no nos quedamos en silencio:
  // saltamos a la siguiente. Limitamos los saltos para no entrar en loop si todo está roto.
  els.audio.addEventListener('error', ()=>{
    // Ignoramos abortos (ocurre cuando cambiamos `src` nosotros mismos antes de que termine de cargar)
    const err = els.audio.error;
    if (err && err.code === 1 /* MediaError.MEDIA_ERR_ABORTED */) return;
    if (state.playingAlbumIdx === -1 || state.playingTrackIdx === -1) return;
    consecutivePlaybackErrors++;
    console.warn('SpotifAI: error cargando pista', err && err.code, '— intento', consecutivePlaybackErrors);
    // Pista que falló (la que está en `playing*Idx` ahora)
    const failedAlbum = state.albums[state.playingAlbumIdx];
    const failedTrack = failedAlbum && failedAlbum.tracks[state.playingTrackIdx];
    if (failedTrack){
      showToast(`Pista no disponible — saltando: ${failedTrack.title}`);
    } else {
      showToast('Pista no disponible — saltando');
    }
    if (consecutivePlaybackErrors > MAX_CONSECUTIVE_PLAYBACK_ERRORS) {
      console.warn('SpotifAI: demasiados errores consecutivos, detengo reproducción');
      consecutivePlaybackErrors = 0;
      showToast('Demasiados errores — reproducción detenida', 3200);
      // Apagamos buffering por si quedó colgado
      state.isBuffering = false;
      updatePlayIcon();
      return;
    }
    advanceAfterCurrent();
  });

  // Reseteamos el contador cuando la reproducción arranca de verdad (no solo cuando se llama play())
  els.audio.addEventListener('playing', ()=>{
    consecutivePlaybackErrors = 0;
    state.isBuffering = false;
    updatePlayIcon();
    updateMediaSessionPlaybackState();
  });

  // === Buffering UI ===
  els.audio.addEventListener('waiting', ()=>{
    // Solo mostramos spinner si la intención era estar sonando (no pausado a propósito).
    if (!els.audio.paused){
      state.isBuffering = true;
      updatePlayIcon();
    }
  });
  els.audio.addEventListener('stalled', ()=>{
    if (!els.audio.paused){
      state.isBuffering = true;
      updatePlayIcon();
    }
  });
  els.audio.addEventListener('canplay', ()=>{
    state.isBuffering = false;
    updatePlayIcon();
  });
  els.audio.addEventListener('loadstart', ()=>{
    // Al cambiar de pista, asumimos buffering hasta que llegue 'playing' o 'canplay'.
    state.isBuffering = !els.audio.paused;
    updatePlayIcon();
  });

  // Sync del estado de Media Session cuando cambia play/pause
  els.audio.addEventListener('play', updateMediaSessionPlaybackState);
  els.audio.addEventListener('pause', updateMediaSessionPlaybackState);
  els.audio.addEventListener('durationchange', updateMediaSessionPosition);

}

const cmp = {
  title_asc: (a,b)=> a.title.localeCompare(b.title, undefined, {sensitivity:'base'}),
  artist_asc: (a,b)=> (a.artist||'').localeCompare((b.artist||''), undefined, {sensitivity:'base'}) || a.title.localeCompare(b.title),
  tracks_desc: (a,b)=> (b.tracks.length - a.tracks.length) || a.title.localeCompare(b.title),
  released_desc: (a,b)=> {
    const da = parseDateYYYYMMDD(a.date_released), db = parseDateYYYYMMDD(b.date_released);
    if (da && db) return db - da;
    if (db) return 1;
    if (da) return -1;
    return a.title.localeCompare(b.title);
  },
  added_desc: (a,b)=> {
    const da = parseDateYYYYMMDD(a.date_added), db = parseDateYYYYMMDD(b.date_added);
    if (da && db) return db - da;
    if (db) return 1;
    if (da) return -1;
    return a.title.localeCompare(b.title);
  },
  recommended_first: (a,b)=> {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    // dentro de cada grupo, por date_added desc
    return cmp.added_desc(a,b);
  }
};

function sortAlbumsInPlace(mode){
  const current = state.albums[state.playingAlbumIdx]?.id || null;
  const selected = state.albums[state.selectedAlbumIdx]?.id || null;

  state.albums.sort(cmp[mode] || cmp.added_desc);

  // re-map índices después de ordenar
  function idxById(id){
    if (!id) return -1;
    return state.albums.findIndex(a => a.id === id);
  }
  state.playingAlbumIdx = idxById(current);
  state.selectedAlbumIdx = idxById(selected);
}

function applySortAndRender(){
  sortAlbumsInPlace(state.sortMode || 'added_desc');
  renderCarousel();
  // después de re-render, siempre volver al inicio del carrusel
  scrollCarouselToStart();
  updateCarouselIndicators();
}



async function loadManifest(){
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error('manifest.json not found. run the generator.');
  const data = await res.json();

  // normalize: ahora incluimos id, dates y recommended
  state.albums = (data.albums || []).map(a => ({
    id: a.id || a.folder || a.title,         // id estable del generator
    title: a.title,
    folder: a.folder,
    coverExists: !!a.coverExists,
    artist: a.artist || null,
    date_released: a.date_released || null,
    date_added: a.date_added || null,
    recommended: !!a.recommended,
    tracks: (a.tracks || []).map(t => ({
      number: t.number,
      title: t.title,
      base: t.base,
      pngExists: !!t.pngExists,
      duration: t.duration ?? null,
    })),
  }));

  // NO ordenamos acá por cantidad; aplicamos el sort default (added_desc) luego
}



(async function init(){
  try{
    attachEvents();
    setupMediaSessionHandlers();
    await loadManifest();

    state.sortMode = 'recommended_first';
    applySortAndRender();

    attachCarouselArrowHandlers();

    // wiring del dropdown "Ordenar por"
    if (els.sortMode){
      els.sortMode.value = state.sortMode;
      els.sortMode.addEventListener('change', () => {
        state.sortMode = els.sortMode.value;
        const selId = state.albums[state.selectedAlbumIdx]?.id || null;
        applySortAndRender();
        if (selId){
          const idx = state.albums.findIndex(a => a.id === selId);
          if (idx !== -1){
            state.selectedAlbumIdx = idx;
            updateCarouselIndicators();
          }
        }
      });
    }


    // URL -> abrir álbum si viene ?album=<slug>
    const slug = getAlbumSlugFromUrl();
    let initIdx = findAlbumIndexBySlug(slug);

    if (initIdx === -1 && state.albums.length) initIdx = 0;

    if (initIdx !== -1){
      suppressUrlUpdate = true;     // no volvemos a empujar estado al setearlo desde URL
      selectAlbum(initIdx);
      suppressUrlUpdate = false;
      // Aseguramos que la URL quede normalizada (si no había param o venía roto)
      if (!slug || slug !== albumSlug(state.albums[initIdx])) {
        setAlbumSlugInUrl(albumSlug(state.albums[initIdx]), {replace:true});
      }
    }

    // Si viene ?track=<slug> en la URL, solo preseleccionamos/mostramos (sin autoplay)
    const trackParam = getTrackSlugFromUrl();
    if (trackParam && initIdx !== -1) {
      const trkIdx = state.albums[initIdx].tracks.findIndex(t => trackSlug(t) === trackParam);
      if (trkIdx !== -1) {
        // mostrar info de ese track sin reproducir
        const alb = state.albums[initIdx];
        const t = alb.tracks[trkIdx];
        els.nowSong.textContent = `${pad(t.number)} — ${t.title}`;
        els.nowAlbum.textContent = alb.artist ? `${alb.title} — ${alb.artist}` : alb.title;
        els.nowCover.src = trackCoverUrl(alb, t);
        // no seteamos els.audio.play(); ni cambiamos src (si querés, podés precargar metadata):
        const src = encodePath(`${alb.folder}/${t.base}.mp3`);
        const abs = (new URL(src, location.href)).href;
        if (els.audio.src !== abs) els.audio.src = src; // solo preload, no reproducir
      }
    }


    // Soporte para botón Atrás/Adelante del navegador
    window.addEventListener('popstate', () => {
      const sAlb = getAlbumSlugFromUrl();
      const idxAlb = findAlbumIndexBySlug(sAlb);
      if (idxAlb !== -1){
        suppressUrlUpdate = true;
        selectAlbum(idxAlb);
        suppressUrlUpdate = false;

        const sTrk = getTrackSlugFromUrl();
        if (sTrk){
          const trkIdx = state.albums[idxAlb].tracks.findIndex(t => trackSlug(t) === sTrk);
          if (trkIdx !== -1){
            // Solo mostrar/preparar, sin autoplay
            const alb = state.albums[idxAlb];
            const t = alb.tracks[trkIdx];
            els.nowSong.textContent = `${pad(t.number)} — ${t.title}`;
            els.nowAlbum.textContent = alb.artist ? `${alb.title} — ${alb.artist}` : alb.title;
            els.nowCover.src = trackCoverUrl(alb, t);
            const src = encodePath(`${alb.folder}/${t.base}.mp3`);
            const abs = (new URL(src, location.href)).href;
            if (els.audio.src !== abs) els.audio.src = src;
          }
        }
      }
    });


  }catch(err){
    console.error(err);
    document.querySelector('.content').innerHTML = `
      <div class="tracks-panel">
        <h2>Setup needed</h2>
        <p>Couldn’t find <code>manifest.json</code>. Please run <code>node generate-manifest.mjs</code> locally and commit the generated file.</p>
      </div>`;
  }
})();
