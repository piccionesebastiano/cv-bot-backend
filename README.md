# cv-bot-backend

NestJS API that powers an LLM-backed chatbot answering questions about a CV. It proxies chat requests to [OpenRouter](https://openrouter.ai) (DeepSeek Chat), grounds every answer in a single source-of-truth CV document, and caches semantically-similar questions to cut latency and token spend.

Pairs with **[cv-bot-frontend](https://github.com/piccionesebastiano/cv-bot-frontend)** — the embeddable widget and admin UI that talk to this API. If you're deploying the two together, set this backend's `ALLOWED_ORIGINS` to the domain hosting the frontend, and the frontend's `apiUrl` to this backend's public URL. See the [frontend README](https://github.com/piccionesebastiano/cv-bot-frontend#readme) for the widget-side config.

## How it works

```
┌────────────────────┐        POST /chat, /chat/stream        ┌──────────────────────┐        ┌──────────────┐
│  cv-bot-frontend    │ ───────────────────────────────────▶  │   cv-bot-backend      │ ─────▶ │  OpenRouter  │
│  (widget + admin)   │ ◀───────────────────────────────────  │   (this repo)         │ ◀───── │  DeepSeek    │
└────────────────────┘        x-widget-token / x-admin-secret └──────────────────────┘        └──────────────┘
                                                                        │
                                                          ┌─────────────┴─────────────┐
                                                          │  semantic cache (Redis or │
                                                          │  data/cache.json)          │
                                                          │  CV doc (data/cv-content.md│
                                                          │  or Railway volume)        │
                                                          └────────────────────────────┘
```

- **Grounding**: `CvLoaderService` loads a Markdown CV, hashes it, and builds the system prompt (`src/chat/prompts/cv-system-prompt.ts`) served to the model on every request.
- **Semantic cache**: `SemanticCacheService` embeds incoming questions (`openai/text-embedding-3-small` via OpenRouter) and serves a cached answer on cosine similarity ≥ 0.88, avoiding a full LLM round-trip. Backed by Redis when `REDIS_URL` is set, otherwise a local JSON file.
- **Anti-repetition**: `src/chat/prompts/episodes.ts` catalogues the anecdotes the CV supports and scans the *full* client history (up to 20 messages) for the ones already used, appending a "don't reuse these" system note. The history window sent to the model is shorter, so without this a repeated "tell me another" would recycle stories that had scrolled out of context.
- **Streaming**: `/chat/stream` proxies OpenRouter's SSE stream and incrementally extracts the `reply` field out of the model's structured JSON output as it arrives.
- **Guardrails**: `injection-patterns.ts` rejects prompt-injection attempts before they reach the model; `ValidationPipe` with `whitelist`/`forbidNonWhitelisted` rejects malformed payloads; request bodies are capped at 16kb.
- **Admin**: `/admin/cv` lets an authenticated caller hot-swap the CV content at runtime (persisted to a volume) without a redeploy, invalidating the semantic cache on update.
- **Site analytics**: `SiteAnalyticsService` powers the click/attention heatmap for the whole site (`POST /site/events`). **Raw hits are never stored** — every event is folded into fixed-size aggregates on arrival, so memory is bounded by the shape of the site (pages × devices × grid cells), not by traffic: a page with a million clicks costs the same as one with a thousand. Positions are normalised to *% of viewport width* horizontally and *absolute px from the document top* vertically, which survives responsive reflow, then bucketed into a 100-column × 40px grid per (page, device, layer). Scroll depth is kept as 20 reach bands and click targets as a capped selector→count map. See the [project structure](#project-structure) for the module layout.
- **Analytics**: `AnalyticsService` collects batched widget events (`POST /events`) — which suggestion chips get clicked, what gets asked, whether the proactive nudge converts — and aggregates them for `/admin/analytics`. Same storage strategy as the cache: Redis when `REDIS_URL` is set, `data/analytics.json` otherwise, capped at the last 5 000 events. No cookies and no persistent identifier: events carry only the ephemeral `sessionId` the widget already sends with each chat turn.

## API

| Method | Path             | Auth                | Description                                      |
|--------|------------------|----------------------|---------------------------------------------------|
| POST   | `/chat`          | `x-widget-token`*    | Single-turn or multi-turn chat, JSON response      |
| POST   | `/chat/stream`   | `x-widget-token`*    | Same, streamed via Server-Sent Events              |
| POST   | `/events`        | `x-widget-token`*    | Batched widget telemetry (max 30 events), `204`    |
| POST   | `/site/events`   | `x-widget-token`*    | Batched site telemetry (max 40 events), `204`      |
| GET    | `/health`        | none                  | Liveness check                                     |
| GET    | `/admin/cv`      | `x-admin-secret`      | Current CV hash + cache size                       |
| GET    | `/admin/cv/content` | `x-admin-secret`   | Raw CV Markdown content                            |
| POST   | `/admin/cv`      | `x-admin-secret`      | Replace CV content, clears semantic cache          |
| GET    | `/admin/analytics` | `x-admin-secret`    | Aggregated widget stats (top chips, engagement…)   |
| GET    | `/admin/analytics/events` | `x-admin-secret` | Raw events, most recent first                 |
| DELETE | `/admin/analytics` | `x-admin-secret`    | Wipe collected events                              |
| GET    | `/admin/site`    | `x-admin-secret`      | Site-wide overview (sessions, pages, referrers)    |
| GET    | `/admin/site/heatmap` | `x-admin-secret` | Heatmap grid for `?path=&device=&layer=`           |
| DELETE | `/admin/site`    | `x-admin-secret`      | Reset all site analytics                           |

\* `x-widget-token` is only enforced if `WIDGET_SECRET` is set (guard is a no-op otherwise, for backwards compatibility).

`POST /chat` request body:

```json
{
  "message": "Che stack tecnologico usi?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
}
```

## Getting started

```bash
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY at minimum
npm run start:dev
```

Requires an OpenRouter API key ([openrouter.ai](https://openrouter.ai)) and Node 20+.

## Environment variables

| Variable            | Required | Default | Notes                                                                 |
|----------------------|----------|---------|------------------------------------------------------------------------|
| `OPENROUTER_API_KEY` | yes      | —       | Used for both chat completions and embeddings                          |
| `LLM_MODEL`          | no       | `deepseek/deepseek-v4-flash` | Chat model; must be served by one of the allowlisted providers |
| `PORT`               | no       | `3000`  |                                                                          |
| `NODE_ENV`           | no       | —       | Set to `production` to enable `trust proxy`                            |
| `ALLOWED_ORIGINS`    | yes*     | —       | Comma-separated CORS allowlist; empty means all origins are blocked    |
| `THROTTLE_TTL`       | no       | `60000` | Rate-limit window (ms), applies globally                               |
| `THROTTLE_LIMIT`     | no       | `10`    | Max requests per window per client                                     |
| `WIDGET_SECRET`      | no       | —       | If set, `/chat*` requires a matching `x-widget-token` header           |
| `ADMIN_SECRET`       | yes**    | —       | Required to use any `/admin/*` endpoint                                |
| `REDIS_URL`          | no       | —       | Enables shared/persistent cache + rate-limit storage across instances  |
| `CACHE_DIR`          | no       | `./data`| Where the CV content and file-based cache are persisted                |

\* Required in practice — without it, CORS blocks every browser request.
\*\* `/admin/*` returns `400` if unset, effectively disabling the admin API.

## Security notes

- Admin and widget secrets are compared with `crypto.timingSafeEqual` (`src/common/safe-equal.ts`) to avoid timing attacks.
- `/admin/*` has its own tighter rate limit (3 req/min) on top of the global throttle, since it's the highest-value target for brute-forcing `ADMIN_SECRET`.
- CORS is an explicit allowlist, not a wildcard.
- Rotate `ADMIN_SECRET` / `WIDGET_SECRET` periodically — generate with `openssl rand -hex 32`.

## Docker

```bash
docker compose up --build
```

Starts the API alongside a Redis instance (`docker-compose.yml`); the API expects `.env` to exist in the project root.

## Testing

```bash
npm test        # unit tests (jest)
npm run test:cov
```

## Project structure

```
src/
├── main.ts                     # bootstrap: helmet, CORS, validation, body limits
├── app.module.ts                # throttler config, global guard
├── chat/
│   ├── chat.controller.ts       # POST /chat, /chat/stream, /events, GET /health
│   ├── chat.service.ts          # OpenRouter calls, streaming parser, cache orchestration
│   ├── admin.controller.ts      # /admin/cv, /admin/conversations, /admin/analytics
│   ├── semantic-cache.service.ts
│   ├── conversation-log.service.ts
│   ├── analytics.service.ts     # widget event collection + aggregation
│   ├── injection-patterns.ts
│   └── prompts/cv-system-prompt.ts
├── site/
│   ├── site.controller.ts       # POST /site/events
│   ├── site-admin.controller.ts # /admin/site, /admin/site/heatmap
│   └── site-analytics.service.ts # aggregate-on-write heatmap grid + page stats
└── common/
    ├── cv-loader.service.ts     # loads/persists the CV markdown, builds prompt hash
    ├── guards/widget-token.guard.ts
    ├── safe-equal.ts            # constant-time secret comparison
    └── redis-throttler-storage.service.ts
```

## License

MIT — see [LICENSE](LICENSE).
