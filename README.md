# VYBE Music Backend

A frontend-free, serverless API layer intended for a music app. It supports Cloudflare Workers and Vercel, with YouTube Music metadata search, optional Apple/iTunes/KuGou/Spotify metadata providers, multiple lyrics providers, and a **local recommendation-ranking endpoint**.

> **Playback limitation:** search results and a YouTube Music watch link are not a full-length audio stream URL. This backend intentionally does not extract, decrypt, or relay copyrighted audio. For full-length in-app playback, integrate a source/SDK that grants playback rights, or stream audio files you own/have permission to distribute.

## Endpoints

### Health and discovery
- `GET /` — endpoint list and capabilities
- `GET /api/health` — health check

### Music search
- `GET /api/search?q=Blinding%20Lights&source=youtube` — YouTube Music search (default)
- `GET /api/search?q=Blinding%20Lights&source=itunes` — iTunes catalog search; may include short preview URLs
- `GET /api/search?q=Blinding%20Lights&source=apple` — Apple Music catalog search; may require `APPLE_MUSIC_TOKEN`
- `GET /api/search?q=Blinding%20Lights&source=kugou` — KuGou metadata search; upstream availability varies
- `GET /api/search?q=Blinding%20Lights&source=spotify` — Spotify Web API search; requires server-side secrets
- `GET /api/search?q=Blinding%20Lights&source=all` — queries all providers in parallel and returns provider errors in `warnings`
- Optional `limit` parameter is clamped to 1–50.

### Lyrics providers
- `GET /api/lyrics?title=Blinding%20Lights&artist=The%20Weeknd&source=all` — tries all configured lyrics providers and returns results/warnings
- `GET /api/lyrics?title=...&artist=...&source=lrclib`
- `GET /api/lyrics?title=...&artist=...&source=lyricsplus`
- `GET /api/lyrics?title=...&artist=...&source=betterlyrics`
- `GET /api/lyrics?title=...&artist=...&source=paxsenix`
- `GET /api/lyrics?title=...&artist=...&source=kugou`
- `GET /api/lyrics?title=...&artist=...&source=simpmusic&videoId=YOUTUBE_VIDEO_ID` — requires a YouTube video ID
- `GET /api/lyrics/youtube/YOUTUBE_VIDEO_ID?duration=200` — SimpMusic lyrics lookup by video ID
- `GET /api/lyrics/search?q=Blinding%20Lights` — LRCLIB search

Lyrics results are upstream-dependent; synced, rich-synced, TTML, and plain formats are returned in the provider's `data` object when available. Some providers may be offline, rate-limited, or change their response formats. `source=all` includes warnings instead of silently hiding provider failures.

### Recommendations
- `POST /api/recommendations` — local ranking; no external recommendation service is called.
- `POST /api/recommendations/feedback` — normalizes a play/skip event for the app to store locally. The backend does not retain listening history.

Example request to `POST /api/recommendations`:

```json
{
  "currentTrackId": "track-123",
  "likedTrackIds": ["track-456"],
  "skippedTrackIds": ["track-789"],
  "recentTrackIds": ["track-222"],
  "preferredArtists": ["The Weeknd"],
  "preferredGenres": ["pop"],
  "limit": 10,
  "candidates": [
    {"id":"track-456","title":"Example Song","artists":["The Weeknd"],"genres":["pop"]},
    {"id":"track-999","title":"Other Song","artists":["Another Artist"],"genres":["rock"]}
  ]
}
```

The app sends the candidate list and preference signals; the server scores candidates and returns `suggestions`, `matchReason`, and `tasteProfileUpdate`. The endpoint is stateless by design, so save user preferences/history in your app or your own database if you want persistence.

### Playback link
- `GET /api/playback/youtube/YOUTUBE_VIDEO_ID` — returns the official YouTube Music watch link. It deliberately does not return an extracted audio stream URL.

## Local test

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Try these URLs locally:

```text
http://localhost:8787/api/health
http://localhost:8787/api/search?q=Blinding%20Lights&source=youtube
http://localhost:8787/api/search?q=Blinding%20Lights&source=all
http://localhost:8787/api/lyrics?title=Blinding%20Lights&artist=The%20Weeknd&source=all
http://localhost:8787/api/lyrics/youtube/5Eqb_-j3FDA
```

The endpoints above are test examples, not a guarantee that every upstream provider is currently online.

## Deploy to Cloudflare Workers

1. Push this folder's contents to a GitHub repository.
2. In Termux/PC, run `npm install` and `npx wrangler login`.
3. Run `npm run deploy` (or import the repository into Cloudflare and use `npx wrangler deploy`).
4. Your base URL will look like `https://<worker-name>.<your-subdomain>.workers.dev`.

## Deploy to Vercel

1. Import this repository into Vercel.
2. Choose **Other** as framework preset; install command `npm install`.
3. Deploy. The included `api/[[...route]].js` forwards requests to the Hono app.

## Optional provider secrets

Set these as platform environment variables/secrets, never commit them to GitHub:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `APPLE_MUSIC_TOKEN` (only if Apple Music catalog calls require one in your region/account)

Spotify's public search API needs a Spotify developer app/client credentials. The app's original private/internal Spotify GraphQL endpoint is not used here.

## Privacy and upstream behavior

- This backend does not include the Android frontend, original app updater, original developer-owned telemetry endpoint, or the original remote FlowNeuroengine call.
- Search/lyrics queries are sent to whichever upstream provider(s) are selected to fulfill the request. That is unavoidable for third-party catalog/lyrics data; avoid sending personal information in search terms.
- Recommendation scoring runs in this backend and does not send listening events to the original project's external recommendation service.
- No user login, analytics, or listening-history database is configured.
- Open CORS is enabled for development. Add rate limiting and restrict allowed origins before public production use.
- YouTube Music InnerTube is undocumented and can change or rate-limit requests. Spotify/Apple/KuGou and lyrics providers have their own access rules, availability, and terms.

## Attribution

This is a separate backend implementation, not the official Echo Music server and not affiliated with YouTube, Apple, Spotify, KuGou, or the lyrics providers. See `THIRD_PARTY_NOTICES.md`. If you copy or adapt source code from Echo Music or another project, keep its notices and comply with that project's license. Removing telemetry does not transfer copyright or make upstream projects your original work.
