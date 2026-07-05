const CACHE = "spotifai-shell-v4";
const OFFLINE_CACHE = "spotifai-offline-v1";
const MEDIA_RE = /\.(mp3|wav|ogg|m4a|flac|webm|mp4)$/i;
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![CACHE, OFFLINE_CACHE].includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function rangeResponse(req, cached){
  const range = req.headers.get("range");
  if (!range) return cached;

  const buffer = await cached.arrayBuffer();
  const size = buffer.byteLength;
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return cached;

  let start;
  let end;
  if (match[1] === "" && match[2] !== "") {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = match[1] ? Number(match[1]) : 0;
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, {
      status: 416,
      statusText: "Range Not Satisfiable",
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  end = Math.min(end, size - 1);
  const chunk = buffer.slice(start, end + 1);
  const headers = new Headers(cached.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(chunk.byteLength));
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.delete("Content-Encoding");

  return new Response(chunk, {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (MEDIA_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        const cached = await cache.match(url.href);
        if (cached) return rangeResponse(req, cached);
        return fetch(req);
      })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
