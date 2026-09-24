# StoneSight AI — Backend Reference

Express + TypeScript (run with `tsx`), Supabase Auth. The backend holds all API
keys and talks to exactly two AI providers: **Anthropic Claude** and
**NVIDIA NIM**.

```
Browser (Vite :3000) ── fetch VITE_API_URL ──► Express (:5000)  server/server.ts → server/app.ts
                                                 ├─ GET  /api/health              (public)
                                                 ├─ POST /api/analyze             Claude / NVIDIA VLM
                                                 ├─ POST /api/image/generate      NVIDIA FLUX.1 Kontext
                                                 ├─ POST /api/video/generate      NVIDIA Cosmos (async job)
                                                 ├─ GET  /api/video/status/:id
                                                 └─ static /images, /videos       generated assets (public/)
```

## Running

```bash
npm run server          # backend only (:5000)
npm run dev:all         # frontend + backend
npm run check:providers # verify keys and endpoints
```

The server starts even without keys; `/api/health` then reports no providers
and the frontend explains what to configure.

## Environment variables

Loaded from `server/.env`, then the project-root `.env`; real environment
variables always win. See `.env.example`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5000` | HTTP port |
| `CLIENT_URL` | *(allow all)* | Comma-separated CORS origins |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | — | Token verification (the `VITE_` variants are accepted too) |
| `MCP_TEST_MODE` | — | `true` bypasses auth (**development/tests only**) |
| `ANTHROPIC_API_KEY` | — | Enables Claude scene analysis |
| `CLAUDE_MODEL` | `claude-opus-5` | Claude model |
| `CLAUDE_ANALYSIS_EFFORT` | `high` | `low`…`max` |
| `CLAUDE_BASE_URL` | — | Anthropic-compatible gateway for the app (wins over `ANTHROPIC_BASE_URL`) |
| `NVIDIA_API_KEY` | — | Hosted NVIDIA endpoints + NVIDIA VLM fallback |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | OpenAI-compatible NVIDIA API |
| `NVIDIA_VLM_MODEL` | `meta/llama-3.2-90b-vision-instruct,meta/llama-3.2-11b-vision-instruct` | Fallback analysers, tried in order |
| `FLUX_INFERENCE_URL` | — | Self-hosted Kontext NIM (`…/v1/infer`) |
| `NVIDIA_IMAGE_EDIT_URL` | hosted Kontext URL | Override hosted endpoint |
| `NVIDIA_HOSTED_IMAGE` | `true` | `false` skips the hosted Kontext endpoint |
| `COSMOS_INFERENCE_URL` | — | Cosmos image-to-video NIM |
| `COSMOS_EXTRA_PARAMS` | — | JSON merged into the Cosmos request |

## Authentication (`server/middleware/auth.ts`)

All routes except `/api/health` require `Authorization: Bearer <Supabase access token>`.
Missing/invalid token → `401 UNAUTHORIZED`; missing Supabase config → `500 AUTH_CONFIG`.
`req.user = { id, email }` is attached for handlers (video jobs are scoped per user).

## Endpoints

All error bodies have the shape `{ success: false, code, error, details? }`.

### `GET /api/health`
```json
{ "ok": true, "providers": {
  "analysis": "claude" | "nvidia-vlm" | null,
  "analysisModels": { "claude": "claude-opus-5", "nvidiaVlm": ["…"] },
  "image": ["nvidia-kontext-self-hosted", "nvidia-kontext-hosted"],
  "video": ["nvidia-cosmos"] } }
```

### `POST /api/analyze`
Body: `{ image: dataURL, swatch?: dataURL, stone: { name, category?, tone?, description? } }`
200: `{ success, analysis: SceneAnalysis, analyzer, model }` — see [claude-scene-analysis.md](claude-scene-analysis.md).
Errors: `400 BAD_REQUEST`, `503 NO_ANALYZER`, `502 CLAUDE_*` / `NVIDIA_VLM_*`, `422 CLAUDE_REFUSAL`.

### `POST /api/image/generate`
Body: `{ image: dataURL, prompt?: string, stone?: {...}, seed?: number }` (`prompt` is Claude's `edit_instruction`; otherwise a strict template is built from `stone`).
200: `{ success, image: dataURL, localPath: "/images/…", provider }`
Errors: `503 NVIDIA_IMAGE_UNAVAILABLE` (nothing configured), `502 NVIDIA_IMAGE_FAILED` (every endpoint failed; `details` lists each).
See [image-pipeline-setup.md](image-pipeline-setup.md).

### `POST /api/video/generate` and `GET /api/video/status/:jobId`
Body: `{ image: dataURL, prompt?: string, stone?: {...}, seed?: number }` → `202 { success, jobId }`.
Status: `{ success, status: "queued"|"running"|"succeeded"|"failed", videoUrl?, error? }`; unknown job → `404`.
`503 NVIDIA_VIDEO_UNAVAILABLE` when `COSMOS_INFERENCE_URL` is unset.
See [video-pipeline-setup.md](video-pipeline-setup.md).

## Generated assets

Images → `public/images/`, videos → `public/videos/` (git-ignored), served at
`/images/*` and `/videos/*`. The frontend resolves them against `VITE_API_URL`.

## Logging

| Prefix | Source |
|--------|--------|
| `[DIAGNOSTIC]` | Startup provider summary (secrets masked) |
| `[REQUEST]` | Each `/api/*` request |
| `[ANALYZE]` | Claude / NVIDIA VLM analysis (model, surface count, token usage) |
| `[IMAGE]` | Kontext attempts, provider failures, hosted example-only detection |
| `[VIDEO]` | Cosmos jobs |
| `[AUTH]` | Auth configuration problems |

Logs never contain API keys or image payloads.

## Tests

`npm test` runs `tests/server.test.ts` against the real app with a fake NVIDIA
NIM and a fake Anthropic Messages API (via `ANTHROPIC_BASE_URL`), covering the
Claude request shape (model, adaptive thinking, structured output, refusal
fallback, three images), the Kontext image-to-image call, the Cosmos job
lifecycle, structured 503s and auth.
