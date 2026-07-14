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
- **Streaming**: `/chat/stream` proxies OpenRouter's SSE stream and incrementally extracts the `reply` field out of the model's structured JSON output as it arrives.
- **Guardrails**: `injection-patterns.ts` rejects prompt-injection attempts before they reach the model; `ValidationPipe` with `whitelist`/`forbidNonWhitelisted` rejects malformed payloads; request bodies are capped at 16kb.
- **Admin**: `/admin/cv` lets an authenticated caller hot-swap the CV content at runtime (persisted to a volume) without a redeploy, invalidating the semantic cache on update.

## API

| Method | Path             | Auth                | Description                                      |
|--------|------------------|----------------------|---------------------------------------------------|
| POST   | `/chat`          | `x-widget-token`*    | Single-turn or multi-turn chat, JSON response      |
| POST   | `/chat/stream`   | `x-widget-token`*    | Same, streamed via Server-Sent Events              |
| GET    | `/health`        | none                  | Liveness check                                     |
| GET    | `/admin/cv`      | `x-admin-secret`      | Current CV hash + cache size                       |
| GET    | `/admin/cv/content` | `x-admin-secret`   | Raw CV Markdown content                            |
| POST   | `/admin/cv`      | `x-admin-secret`      | Replace CV content, clears semantic cache          |

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
│   ├── chat.controller.ts       # POST /chat, /chat/stream, GET /health
│   ├── chat.service.ts          # OpenRouter calls, streaming parser, cache orchestration
│   ├── admin.controller.ts      # /admin/cv (read/write CV content)
│   ├── semantic-cache.service.ts
│   ├── injection-patterns.ts
│   └── prompts/cv-system-prompt.ts
└── common/
    ├── cv-loader.service.ts     # loads/persists the CV markdown, builds prompt hash
    ├── guards/widget-token.guard.ts
    ├── safe-equal.ts            # constant-time secret comparison
    └── redis-throttler-storage.service.ts
```

## License

MIT — see [LICENSE](LICENSE).
