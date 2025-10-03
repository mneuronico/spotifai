/* global fetch */
const manifestUrl = 'manifest.json';

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
};

let state = {
  albums: [],
  selectedAlbumIdx: -1,
  playingAlbumIdx: -1,
  playingTrackIdx: -1,
  shuffledIndices: null,
  isShuffle: false,
  isLoop: false,
  sortMode: 'recommended_first',
  today: new Date(),
};

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

function startPlayingAt(albumIdx, trackIdx){
  state.playingAlbumIdx = albumIdx;
  state.playingTrackIdx = trackIdx;
  state.selectedAlbumIdx = (state.selectedAlbumIdx === -1 ? albumIdx : state.selectedAlbumIdx);
  state.shuffledIndices = null; // reset cuando arranca nuevo álbum

  const album = state.albums[albumIdx];
  const track = album.tracks[trackIdx];

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
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return;
  const nextIdx = nextIndex();
  startPlayingAt(state.playingAlbumIdx, nextIdx);
}

function playPrev(){
  const album = state.albums[state.playingAlbumIdx];
  if (!album) return;
  const prevIdx = prevIndex();
  startPlayingAt(state.playingAlbumIdx, prevIdx);
}


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
  els.audio.addEventListener('play', ()=>{ updatePlayIcon(); updateCarouselIndicators(); });
  els.audio.addEventListener('pause', ()=>{ updatePlayIcon(); updateCarouselIndicators(); });

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
    if (state.isLoop) {
      els.audio.currentTime = 0; els.audio.play().catch(()=>{});
      return;
    }

    const album = state.albums[state.playingAlbumIdx];
    if (!album) return;

    const isLastTrackNoShuffle = !state.isShuffle && (state.playingTrackIdx === album.tracks.length - 1);

    if (isLastTrackNoShuffle) {
      // pasar al primer tema del siguiente álbum (circular)
      const nextAlbum = (state.playingAlbumIdx + 1) % state.albums.length;
      startPlayingAt(nextAlbum, 0);
      // si estabas mirando el álbum que sigue, dejá la selección como está; si no, no cambiamos selected
    } else {
      playNext();
    }
  });

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
