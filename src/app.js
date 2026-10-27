import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
const URLS = {
  ytSearch: 'https://music.youtube.com/youtubei/v1/search',
  itunesSearch: 'https://itunes.apple.com/search',
  appleSearch: 'https://amp-api.music.apple.com/v1/catalog',
  kugouSearch: 'https://mobileservice.kugou.com/api/v3/search/song',
  lrclibSearch: 'https://lrclib.net/api/search',
  lrclibGet: 'https://lrclib.net/api/get',
  simpLyrics: 'https://api-lyrics.simpmusic.org/v1/',
  simpFallback: 'https://vivi-yt-music-server.onrender.com/v1/',
  betterLyrics: 'https://lyrics-api.boidu.dev/getLyrics',
  paxSearch: 'https://lyrics.paxsenix.org/apple-music/search',
  paxLyrics: 'https://lyrics.paxsenix.org/apple-music/lyrics',
  kugouLyricsSearch: 'https://lyrics.kugou.com/search',
  kugouLyricsDownload: 'https://lyrics.kugou.com/download',
};
const YT_CLIENT_VERSION = '1.20261020.01.00';
const LYRICSPLUS_SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
];

app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

const jsonError = (c, status, error, detail) => c.json({ ok: false, error, ...(detail ? { detail } : {}) }, status);
const str = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const timeout = (ms = 10000) => AbortSignal.timeout(ms);
const fetchJson = async (url, options = {}, ms = 10000) => {
  const res = await fetch(url, { ...options, signal: options.signal || timeout(ms) });
  if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
  return res.json();
};

app.get('/', (c) => c.json({
  name: 'VYBE Music Backend', version: '1.1.0', status: 'ok',
  endpoints: {
    health: 'GET /api/health',
    search: 'GET /api/search?q=Blinding%20Lights&source=youtube|itunes|apple|kugou|spotify|all',
    lyrics: 'GET /api/lyrics?title=Blinding%20Lights&artist=The%20Weeknd&source=all',
    lyricsByVideo: 'GET /api/lyrics/youtube/:videoId?duration=200',
    lyricsSearch: 'GET /api/lyrics/search?q=Blinding%20Lights',
    recommendations: 'POST /api/recommendations',
    recommendationFeedback: 'POST /api/recommendations/feedback',
    playbackInfo: 'GET /api/playback/youtube/:videoId',
  },
  notes: [
    'Metadata/lyrics aggregation and local recommendation ranking only.',
    'No original-app analytics, updater, account system, or developer-owned telemetry endpoint is included.',
    'This service does not extract or relay copyrighted audio streams. playback/youtube returns an official watch link.',
  ],
}));
app.get('/api/health', (c) => c.json({ ok: true, service: 'vybe-music-backend', time: new Date().toISOString() }));

function textOf(runs) { return Array.isArray(runs) ? runs.map((r) => r?.text || '').join('').trim() : ''; }
function thumbnailsOf(obj) {
  const thumbs = obj?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || obj?.thumbnail?.thumbnails || obj?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
  return thumbs.filter(t => t?.url).map(t => ({ url: t.url, width: t.width || null, height: t.height || null }));
}
function parseYtMusic(raw) {
  const found = [], seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const r = node.musicResponsiveListItemRenderer;
    if (r) {
      const flex = r.flexColumns || [];
      const titleRuns = flex[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const title = textOf(titleRuns);
      const nav = titleRuns.find(x => x?.navigationEndpoint)?.navigationEndpoint;
      const videoId = nav?.watchEndpoint?.videoId || r.playlistItemData?.videoId;
      const cols = flex.slice(1).map(x => textOf(x?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []));
      const subtitleRuns = flex[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artists = subtitleRuns.filter(x => x?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map(x => x.text).filter(Boolean);
      const album = subtitleRuns.find(x => x?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'))?.text || null;
      const duration = cols.flatMap(x => x.split(' • ')).find(x => /^\d{1,2}:\d{2}$/.test(x)) || null;
      if (title && videoId && !seen.has(videoId)) {
        seen.add(videoId);
        found.push({ id: videoId, title, artists: artists.length ? artists : (cols[0] ? [cols[0].split(' • ')[0]] : []), album, duration, thumbnails: thumbnailsOf(r), source: 'youtube-music', watchUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}` });
      }
    }
    const two = node.musicTwoRowItemRenderer;
    if (two) {
      const title = textOf(two.title?.runs || []);
      const nav = two.navigationEndpoint || two.title?.runs?.find(x => x?.navigationEndpoint)?.navigationEndpoint;
      const videoId = nav?.watchEndpoint?.videoId;
      if (title && videoId && !seen.has(videoId)) {
        seen.add(videoId); found.push({ id: videoId, title, artists: [], album: null, duration: null, thumbnails: thumbnailsOf(two), source: 'youtube-music', watchUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}` });
      }
    }
    for (const v of Object.values(node)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  };
  walk(raw); return found;
}
async function searchYouTubeMusic(q) {
  const raw = await fetchJson(URLS.ytSearch, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/',
      'X-Goog-Api-Format-Version': '1', 'X-YouTube-Client-Name': '67', 'X-YouTube-Client-Version': YT_CLIENT_VERSION,
      'Accept-Language': 'en-IN,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    }, body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: YT_CLIENT_VERSION, hl: 'en', gl: 'IN' } }, query: q }),
  }, 12000);
  return parseYtMusic(raw);
}
async function searchITunes(q, limit = 20) {
  const url = new URL(URLS.itunesSearch); url.searchParams.set('term', q); url.searchParams.set('entity', 'song'); url.searchParams.set('limit', String(limit)); url.searchParams.set('country', 'IN');
  const raw = await fetchJson(url, { headers: { Accept: 'application/json' } });
  return (raw.results || []).map(x => ({ id: String(x.trackId || ''), title: x.trackName || '', artists: [x.artistName].filter(Boolean), album: x.collectionName || null, durationMs: x.trackTimeMillis || null, thumbnails: x.artworkUrl100 ? [{ url: x.artworkUrl100.replace('100x100bb', '600x600bb'), width: 600, height: 600 }] : [], previewUrl: x.previewUrl || null, source: 'itunes', watchUrl: x.trackViewUrl || null }));
}
async function searchApple(q, limit = 20) {
  const url = new URL(`${URLS.appleSearch}/in/search`); url.searchParams.set('term', q); url.searchParams.set('types', 'songs'); url.searchParams.set('limit', String(limit));
  const headers = { Accept: 'application/json', 'Origin': 'https://music.apple.com' };
  if (process.env.APPLE_MUSIC_TOKEN) headers.Authorization = `Bearer ${process.env.APPLE_MUSIC_TOKEN}`;
  const raw = await fetchJson(url, { headers });
  const songs = raw?.results?.songs?.data || [];
  return songs.map(x => { const a = x.attributes || {}; return { id: x.id, title: a.name || '', artists: [a.artistName].filter(Boolean), album: a.albumName || null, durationMs: a.durationInMillis || null, thumbnails: a.artwork?.url ? [{ url: a.artwork.url.replace('{w}', '600').replace('{h}', '600'), width: 600, height: 600 }] : [], source: 'apple-music', watchUrl: a.url || null }; });
}
async function searchKuGou(q, limit = 20) {
  const url = new URL(URLS.kugouSearch); for (const [k,v] of Object.entries({ version: '9108', plat: '0', pagesize: String(limit), showtype: '0', keyword: q })) url.searchParams.set(k, v);
  const raw = await fetchJson(url, { headers: { Accept: 'application/json' } });
  const songs = raw?.data?.info || [];
  return songs.map(x => ({ id: x.hash || String(x.audio_id || x.album_id || ''), title: x.songname || x.song_name || '', artists: [x.singername || x.singer_name].filter(Boolean), album: x.album_name || null, duration: x.duration ? `${Math.floor(x.duration/60)}:${String(x.duration%60).padStart(2,'0')}` : null, thumbnails: x.img ? [{ url: String(x.img).replace('{size}', '400') }] : [], source: 'kugou', watchUrl: null }));
}
async function searchSpotify(q, limit = 20) {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) throw new Error('Spotify requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment secrets');
  const basic = btoa(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`);
  const tokenData = await fetchJson('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const url = new URL('https://api.spotify.com/v1/search'); url.searchParams.set('q', q); url.searchParams.set('type', 'track'); url.searchParams.set('limit', String(limit));
  const raw = await fetchJson(url, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  return (raw?.tracks?.items || []).map(x => ({ id: x.id, title: x.name, artists: (x.artists || []).map(a => a.name), album: x.album?.name || null, durationMs: x.duration_ms || null, thumbnails: (x.album?.images || []).map(i => ({ url: i.url, width: i.width, height: i.height })), source: 'spotify', watchUrl: x.external_urls?.spotify || null, previewUrl: x.preview_url || null }));
}
const SEARCHERS = { youtube: searchYouTubeMusic, 'youtube-music': searchYouTubeMusic, itunes: searchITunes, apple: searchApple, 'apple-music': searchApple, kugou: searchKuGou, spotify: searchSpotify };
app.get('/api/search', async (c) => {
  const q = str(c.req.query('q'), 200), source = str(c.req.query('source') || 'youtube', 24).toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(c.req.query('limit') || 20)));
  if (!q) return jsonError(c, 400, 'Missing query', 'Pass ?q=Song%20Name');
  if (source === 'all') {
    const names = ['youtube', 'itunes', 'apple', 'kugou', 'spotify'];
    const settled = await Promise.allSettled(names.map(s => SEARCHERS[s](q, limit)));
    const results = settled.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
    return c.json({ ok: true, query: q, source, count: results.length, results: results.slice(0, limit * names.length), warnings: settled.map((r,i) => r.status === 'rejected' ? `${names[i]}: ${String(r.reason?.message || r.reason)}` : null).filter(Boolean) });
  }
  const searcher = SEARCHERS[source]; if (!searcher) return jsonError(c, 400, 'Invalid source', `Use one of: ${Object.keys(SEARCHERS).join(', ')}, all`);
  try { const results = await searcher(q, limit); return c.json({ ok: true, query: q, source, count: results.length, results: results.slice(0, limit) }); }
  catch (e) { return jsonError(c, 502, 'Search provider failed', String(e?.message || e)); }
});

function normalizeLyricsTrack(x) { return { id: x.id ?? null, trackName: x.trackName || '', artistName: x.artistName || '', albumName: x.albumName || '', duration: x.duration ?? null, instrumental: Boolean(x.instrumental), syncedLyrics: x.syncedLyrics || null, plainLyrics: x.plainLyrics || null, source: 'lrclib' }; }
async function lrclibSearch(q, title, artist, album) {
  const url = new URL(URLS.lrclibSearch);
  if (q) url.searchParams.set('q', q); if (title) url.searchParams.set('track_name', title); if (artist) url.searchParams.set('artist_name', artist); if (album) url.searchParams.set('album_name', album);
  const data = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': 'VYBE-Music-Backend/1.1 (lyrics lookup)' } });
  return Array.isArray(data) ? data.map(normalizeLyricsTrack) : [];
}
async function getLyricsPlus(title, artist, duration, album, id, isrc) {
  const urls = LYRICSPLUS_SERVERS.map(async server => {
    const url = new URL(`${server}/v2/lyrics/get`); url.searchParams.set('title', title); url.searchParams.set('artist', artist); url.searchParams.set('duration', String(duration || -1));
    if (album) url.searchParams.set('album', album); if (id) url.searchParams.set('id', id); if (isrc) url.searchParams.set('isrc', isrc);
    const data = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': 'VYBE-Music-Backend/1.1' } }, 8000);
    return { provider: 'lyricsplus', server, data };
  });
  const settled = await Promise.allSettled(urls);
  const result = settled.find(x => x.status === 'fulfilled' && hasLyrics(x.value.data));
  if (!result) throw new Error('No LyricsPlus mirror returned lyrics');
  return result.value;
}
function hasLyrics(data) { return Boolean(data && (data.syncedLyrics || data.lyrics || data.plainLyrics || data.richSyncLyrics || data.ttml)); }
async function getSimpLyrics(videoId, duration) {
  let lastError;
  for (const base of [URLS.simpLyrics, URLS.simpFallback]) {
    try {
      const data = await fetchJson(`${base}${encodeURIComponent(videoId)}`, { headers: { Accept: 'application/json', 'User-Agent': 'VYBE-Music-Backend/1.1' } }, 9000);
      const tracks = data?.data || data?.lyrics || [];
      const list = Array.isArray(tracks) ? tracks : [tracks];
      const filtered = list.filter(hasLyrics).sort((a,b) => Math.abs((a.duration||0)-(duration||0)) - Math.abs((b.duration||0)-(duration||0)));
      if (filtered[0]) return { provider: 'simpmusic', data: filtered[0] };
      throw new Error('SimpMusic returned no lyrics');
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('SimpMusic unavailable');
}
async function getBetterLyrics(title, artist, duration, album) {
  const url = new URL(URLS.betterLyrics); url.searchParams.set('s', title); url.searchParams.set('a', artist); if (duration > 0) url.searchParams.set('d', String(duration)); if (album) url.searchParams.set('al', album);
  const data = await fetchJson(url, { headers: { Accept: 'application/json' } }, 9000);
  if (!hasLyrics(data)) throw new Error('BetterLyrics returned no lyrics'); return { provider: 'betterlyrics', data };
}
async function getPaxsenix(title, artist, album) {
  const q = [title, artist, album].filter(Boolean).join(' '); const searchUrl = new URL(URLS.paxSearch); searchUrl.searchParams.set('q', q);
  const search = await fetchJson(searchUrl, { headers: { Accept: 'application/json', 'User-Agent': 'VYBE-Music-Backend/1.1' } }, 8000);
  const items = Array.isArray(search) ? search : (search?.results || search?.data || []);
  if (!items.length) throw new Error('Paxsenix found no candidate');
  const url = new URL(URLS.paxLyrics); url.searchParams.set('id', String(items[0].id));
  const data = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': 'VYBE-Music-Backend/1.1' } }, 8000);
  if (!hasLyrics(data)) throw new Error('Paxsenix returned no lyrics'); return { provider: 'paxsenix', data };
}
async function getKuGouLyrics(title, artist, duration, album) {
  const q = [title, artist, album].filter(Boolean).join(' - ');
  const searchUrl = new URL(URLS.kugouLyricsSearch); for (const [k,v] of Object.entries({ ver: '1', man: 'yes', client: 'pc', keyword: q, duration: duration > 0 ? String(duration * 1000) : '' })) if (v) searchUrl.searchParams.set(k,v);
  const search = await fetchJson(searchUrl, { headers: { Accept: 'application/json' } }, 9000);
  const candidate = search?.candidates?.[0]; if (!candidate) throw new Error('KuGou found no lyrics candidate');
  const url = new URL(URLS.kugouLyricsDownload); for (const [k,v] of Object.entries({ fmt:'lrc', charset:'utf8', client:'pc', ver:'1', id:String(candidate.id), accesskey:candidate.accesskey })) url.searchParams.set(k,v);
  const data = await fetchJson(url, { headers: { Accept: 'application/json' } }, 9000);
  if (!data?.content) throw new Error('KuGou returned no lyrics content');
  let lyrics; try { lyrics = atob(data.content); } catch { lyrics = data.content; }
  return { provider: 'kugou-lyrics', data: { syncedLyrics: lyrics, plainLyrics: lyrics, trackName: title, artistName: artist } };
}
const LYRICS_PROVIDERS = {
  lrclib: async (p) => { const tracks = await lrclibSearch(null, p.title, p.artist, p.album); const usable = tracks.filter(hasLyrics); if (!usable.length) throw new Error('LRCLIB found no lyrics'); return { provider: 'lrclib', data: usable.sort((a,b) => Number(Boolean(b.syncedLyrics))-Number(Boolean(a.syncedLyrics)))[0] }; },
  lyricsplus: async (p) => getLyricsPlus(p.title, p.artist, p.duration, p.album, p.id, p.isrc),
  betterlyrics: async (p) => getBetterLyrics(p.title, p.artist, p.duration, p.album),
  paxsenix: async (p) => getPaxsenix(p.title, p.artist, p.album),
  kugou: async (p) => getKuGouLyrics(p.title, p.artist, p.duration, p.album),
  simpmusic: async (p) => { if (!p.videoId) throw new Error('SimpMusic lyrics require videoId'); return getSimpLyrics(p.videoId, p.duration); },
};
app.get('/api/lyrics/search', async (c) => {
  const q = str(c.req.query('q'), 200); if (!q) return jsonError(c, 400, 'Missing query', 'Pass ?q=Song%20Name');
  try { const results = await lrclibSearch(q); return c.json({ ok: true, count: results.length, results }); }
  catch (e) { return jsonError(c, 502, 'Lyrics search failed', String(e?.message || e)); }
});
app.get('/api/lyrics/youtube/:videoId', async (c) => {
  const videoId = str(c.req.param('videoId'), 80); if (!videoId) return jsonError(c, 400, 'Missing video ID');
  try { const result = await getSimpLyrics(videoId, Number(c.req.query('duration') || 0)); return c.json({ ok: true, ...result }); }
  catch (e) { return jsonError(c, 502, 'YouTube lyrics unavailable', String(e?.message || e)); }
});
app.get('/api/lyrics', async (c) => {
  const p = { title: str(c.req.query('title'), 200), artist: str(c.req.query('artist'), 200), album: str(c.req.query('album'), 200), duration: Number(c.req.query('duration') || -1), id: str(c.req.query('id'), 100), isrc: str(c.req.query('isrc'), 30), videoId: str(c.req.query('videoId'), 80) };
  const source = str(c.req.query('source') || 'all', 30).toLowerCase();
  if (!p.title || !p.artist) return jsonError(c, 400, 'Missing fields', 'Pass ?title=...&artist=...; album, duration, id, isrc, videoId are optional');
  if (source !== 'all' && !LYRICS_PROVIDERS[source]) return jsonError(c, 400, 'Invalid lyrics source', `Use ${Object.keys(LYRICS_PROVIDERS).join(', ')}, or all`);
  const names = source === 'all' ? ['lrclib','lyricsplus','betterlyrics','paxsenix','kugou', ...(p.videoId ? ['simpmusic'] : [])] : [source];
  const settled = await Promise.allSettled(names.map(name => LYRICS_PROVIDERS[name](p)));
  const successes = settled.map((r,i) => r.status === 'fulfilled' ? { ...r.value, provider: r.value.provider || names[i] } : null).filter(Boolean);
  const warnings = settled.map((r,i) => r.status === 'rejected' ? `${names[i]}: ${String(r.reason?.message || r.reason)}` : null).filter(Boolean);
  if (source !== 'all' && !successes.length) return jsonError(c, 502, 'Lyrics provider failed', warnings[0] || 'No lyrics found');
  return c.json({ ok: true, found: successes.length > 0, lyrics: successes[0]?.data || null, results: successes, count: successes.length, warnings });
});

// Local, stateless recommendation ranking: no third-party recommendation server receives listening events.
app.post('/api/recommendations', async (c) => {
  let body; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 200) : [];
  if (!candidates.length) return jsonError(c, 400, 'Missing candidates', 'Pass candidates from a music search or catalog result.');
  const norm = v => String(v || '').trim().toLowerCase();
  const preferredArtists = new Set((body.preferredArtists || []).map(norm));
  const preferredGenres = new Set((body.preferredGenres || []).map(norm));
  const likedIds = new Set((body.likedTrackIds || []).map(String));
  const skippedIds = new Set((body.skippedTrackIds || []).map(String));
  const recentIds = new Set((body.recentTrackIds || []).map(String));
  const currentId = String(body.currentTrackId || '');
  const scored = candidates.map(track => {
    const id = String(track.id || ''); const artists = (track.artists || [track.artist]).filter(Boolean).map(norm); const genres = (track.genres || []).map(norm);
    let score = Number(track.baseScore || 0); const reasons = [];
    if (likedIds.has(id)) { score += 8; reasons.push('Previously liked'); }
    if (artists.some(a => preferredArtists.has(a))) { score += 5; reasons.push('Matches preferred artist'); }
    if (genres.some(g => preferredGenres.has(g))) { score += 4; reasons.push('Matches preferred genre'); }
    if (recentIds.has(id)) { score -= 7; reasons.push('Played recently'); }
    if (skippedIds.has(id)) { score -= 12; reasons.push('Skipped before'); }
    if (id && id === currentId) { score -= 20; reasons.push('Currently playing'); }
    if (!reasons.length) reasons.push('Similar catalog candidate');
    return { ...track, recommendationScore: score, matchReason: reasons.join('; ') };
  }).sort((a,b) => b.recommendationScore - a.recommendationScore);
  return c.json({ ok: true, engine: 'vybe-local-ranking-v1', count: scored.length, suggestions: scored.slice(0, Math.max(1, Math.min(50, Number(body.limit || 20)))) , tasteProfileUpdate: { genres: [...preferredGenres].join(', '), confidence: Math.min(1, (likedIds.size + preferredArtists.size + preferredGenres.size) / 10), patternsFound: likedIds.size + preferredArtists.size + preferredGenres.size, modelVersion: 'vybe-local-ranking-v1' } });
});
app.post('/api/recommendations/feedback', async (c) => {
  let body; try { body = await c.req.json(); } catch { return jsonError(c, 400, 'Invalid JSON body'); }
  const trackId = str(body.trackId, 120); if (!trackId) return jsonError(c, 400, 'Missing trackId');
  const durationMs = Math.max(0, Number(body.durationMs || 0)); const skipped = Boolean(body.skipped);
  return c.json({ ok: true, accepted: true, stored: false, trackId, durationMs, skipped, signal: skipped ? 'negative' : durationMs >= 30000 ? 'positive-listen' : 'neutral', note: 'Feedback is returned for the app to store locally; this server does not retain listening history.' });
});
app.get('/api/playback/youtube/:videoId', (c) => {
  const id = str(c.req.param('videoId'), 80); if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return jsonError(c, 400, 'Invalid video ID');
  return c.json({ ok: true, source: 'youtube-music', videoId: id, watchUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`, playbackMode: 'official-link', streamUrl: null, note: 'This endpoint does not extract audio. Use an authorized playback integration/source for full-length in-app streaming.' });
});

app.notFound((c) => jsonError(c, 404, 'Not found', 'See / for available endpoints'));
app.onError((err, c) => jsonError(c, 500, 'Internal server error', String(err?.message || err)));
export default app;
