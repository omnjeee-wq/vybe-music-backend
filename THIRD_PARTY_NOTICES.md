# Third-party service and source notices

This backend is a separate implementation. It does not include the Echo Music Android frontend, original app updater, original developer-owned telemetry endpoint, or the external FlowNeuroengine recommendation call. Recommendation ranking is implemented locally in `src/app.js`.

- **YouTube Music**: search requests use an undocumented InnerTube endpoint. This backend is not affiliated with or endorsed by Google/YouTube. Endpoint availability and terms may change.
- **Apple/iTunes**: catalog metadata is fetched from Apple's services. iTunes results may include short preview audio only; catalog search does not grant full-length streaming rights.
- **Spotify**: uses the documented Web API search endpoint when server-side credentials are configured. It does not use the original app's internal Spotify GraphQL endpoint.
- **KuGou**: metadata and lyric requests use public-facing endpoints that may change or impose regional/access restrictions.
- **LRCLIB**: lyric search uses `lrclib.net`.
- **SimpMusic lyrics**: queries `api-lyrics.simpmusic.org` with a community-hosted fallback.
- **BetterLyrics**: queries `lyrics-api.boidu.dev`.
- **Paxsenix**: queries `lyrics.paxsenix.org`.
- **LyricsPlus / YouLyPlus**: tries the community-hosted mirrors configured in `src/app.js`; mirrors are operated by their respective maintainers and may be unavailable.
- **Hono**, **@hono/vercel**, and **Wrangler** are third-party dependencies; consult their package metadata and upstream licenses.

Third-party provider names and endpoints are used for interoperability only. This project is not endorsed by those services. Each provider's own terms, availability, and rights-holder requirements apply.

If you reuse source code from the original Echo Music project, retain its notices and comply with its GPL-3.0-or-later license. Do not represent this backend as the original project's official server or claim authorship of upstream code.
