# StoneSight AI — Backend Documentation

Premium stone visualization backend: generates photorealistic stone surfaces and
cinematic walkthroughs using NVIDIA NIM models. Built with Express + TypeScript
(run via `tsx`), backed by Supabase Auth.

---

## Architecture

```
Browser (Vite :3000)
   │  fetch  VITE_API_URL (http://localhost:5000)
   ▼
Express server (:5000)  server/server.ts
   ├── authenticate  (Supabase Bearer token)   server/middleware/auth.ts
   ├── /api/image/*  → server/routes/image.ts  (NVIDIA FLUX.1-dev, text-to-image)
   └── /api/video/*  → server/routes/video.ts  (NVIDIA Cosmos 3, image/video→video)
   └── static /images, /videos  (generated assets in server/public)
```

The frontend talks to the backend over HTTP; the backend calls NVIDIA's hosted
NIM endpoints. The NVIDIA API key lives **only** on the backend (never shipped
to the browser).

---

## Running

```bash
npm run dev        # frontend only (Vite, :3000)
npm run server     # backend only (Express, :5000)
npm run dev:all    # both via concurrently
npm run lint       # tsc --noEmit (type-checks src/ only)
```

The backend **exits immediately** if `NVIDIA_API_KEY` is missing (see
`server/server.ts` bootstrap check).

---

## Environment variables

Server-side (`.env` at project root — **never commit this file**):

| Variable | Required | Default / Notes |
| --- | --- | --- |
| `NVIDIA_API_KEY` | ✅ | `nvapi-…` key from build.nvidia.com. Fatal if absent. |
| `NVIDIA_IMAGE_URL` | ❌ | Override for the FLUX endpoint. Defaults to the hosted NIM URL below. |
| `PORT` | ❌ | `5000` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | ✅ (for auth) | Also consumed by `server/middleware/auth.ts` to verify tokens. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | ❌ | Fallbacks if the `VITE_`-prefixed vars aren't set. |

> ⚠️ `.env.example` still lists `GEMINI_API_KEY` for historical reasons. The
> backend no longer uses Gemini — ignore it.

---

## Authentication (`server/middleware/auth.ts`)

Every `/api/image` and `/api/video` route is wrapped in `authenticate`, which:

1. Reads `Authorization: Bearer <token>` from the request header.
2. Verifies the token with `supabase.auth.getUser(token)`.
3. Attaches `req.user = { id, email }` and calls `next()`; otherwise responds
   `401` (no/invalid token) or `500` (Supabase config missing / verification error).

Frontend requests must include the logged-in user's Supabase session token.

---

## Image generation — `POST /api/image/generate`

**Upstream model:** `black-forest-labs/flux.1-dev` (NVIDIA-hosted NIM).
**Endpoint:** `https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev`
(overridable via `NVIDIA_IMAGE_URL`).

### Request body
```json
{
  "prompt": "Replace all countertops with Bohemian Flame quartz…",
  "image":  "data:image/jpeg;base64,<…>",   // currently UNUSED in base mode
  "num_steps": 30, "seed": 42, "cfg_scale": 5,
  "width": 1024, "height": 1024
}
```

### What the server does
1. Calls NVIDIA with the NIM body (`model`, `prompt`, `height`, `width`,
   `steps`, `cfg_scale`, `seed`, `mode:"base"`).
2. Expects the response shape `{ "artifacts": [ { "base64": "<jpeg>" } ] }`.
3. Decodes the JPEG base64 and writes it to
   `public/images/flux_<timestamp>_<rand>.jpg`.
4. Returns `{ success, localPath: "/images/…jpg", model, timestamp }`.

### ⚠️ Known limitation — text-to-image only
FLUX.1-dev **`base` mode is text-to-image**. The uploaded `image` is currently
**ignored** — the result is a generated stone *texture*, not an edit of your
kitchen photo. For true in-photo material replacement, switch to
`black-forest-labs/flux.1-kontext-dev` (an image-editing model). Tracked as
follow-up work.

### Other routes
- `GET /api/image/status/:id` — stub (returns `completed`; no job store yet).
- `POST /api/image/batch` — fans out `variations[]` as separate prompts.

---

## Video generation — `POST /api/video/generate`

**Upstream model:** `nvidia/cosmos-3-super` (image-to-video or text-to-video).
**Endpoint:** `https://api.nvcf.nvidia.com/v1/infer/nvidia/cosmos-3-super`
(see `COSMOS_API_URL` in `server/routes/video.ts`).

### Request body
```json
{
  "prompt": "Slow cinematic push-in…",
  "imageUrl": "https://… or data:…",   // present ⇒ image-to-video, else text-to-video
  "negativePrompt": "blurry, low quality",
  "duration": 5, "seed": 123,
  "guidance_scale": 6.0, "num_inference_steps": 28
}
```

### Response
```json
{ "success": true, "data": { "id", "videoUrl", "seed", "status": "completed" } }
```
`videoUrl` is `data.outputs?.[0]` or `data.b64_video`.

---

## Static assets & persistence

- Generated images → `public/images/`, served at `GET /images/*`.
- Generated videos → `public/videos/`, served at `GET /videos/*`.
- Files are written to disk (not uploaded to Supabase Storage). The frontend
  loads them by prepending the API base URL to the returned `localPath`.

---

## Error handling & debugging

All backend errors are logged to the server console with a **tagged prefix** so
you can find them quickly:

| Prefix | Source | What it tells you |
| --- | --- | --- |
| `[FLUX]` | image route / NVIDIA call | Endpoint, model, HTTP `status`/`statusText`, truncated NVIDIA response body. |
| `[IMAGE]` | `/api/image/generate` catch | Endpoint, model, message, status, response snippet. |
| `[VIDEO]` | video route / Cosmos call | Endpoint, model, status, statusText, error `stack`. |
| `[DIAGNOSTIC]` | server bootstrap | Confirms `NVIDIA_API_KEY` is loaded (masked). |

Logs are deliberately **safe**: they never print the API key or the multi-MB
base64 image payload (a `safeTruncate` helper caps response dumps at ~600 chars).

### Common failures
- **`401` from `/api/image/generate`** → request missing/invalid Supabase token
  (frontend not sending `Authorization`, or session expired).
- **`Failed to generate image…` + `[FLUX] NVIDIA request failed status 401`** →
  `NVIDIA_API_KEY` invalid/expired.
- **`status 404` from NVIDIA** → wrong model id or endpoint (the old
  `/v1/images/generations` serverless route is NOT provisioned for this key —
  we use the `/v1/genai/black-forest-labs/flux.1-dev` endpoint instead).
- **Image generates but isn't visible** → ensure `app.use('/images', …)` static
  mount exists in `server/server.ts` (it does) and the frontend prefixes the
  API URL to `localPath`.

---

## Known tech debt (not yet addressed)
- `server/utils/genai.ts` is orphaned half-migrated code (duplicate
  `generateImage`/`generateVideo` exports referencing an undefined
  `GoogleGenAI` type). Not compiled by the `tsconfig` (only `src/**`) and not
  imported anywhere — safe to delete or finish.
- `server/server.ts` CSP header allows `https://googlesvc.eduvention-videos.io`
  (not a project domain) — review/remove.
- Image generation is text-to-image only (see limitation above).
