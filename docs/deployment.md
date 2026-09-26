# Deployment

StoneSight runs as two pieces:

| Piece | Host | What it does |
|---|---|---|
| Website (Vite/React) | **Vercel** — builds from GitHub on every push | Upload, stone picker, local renderer, 3D walkthrough, browser-recorded video |
| API server (Express) | **Railway** — project `stonesight-ai`, service `api` | Claude scene analysis, Gemini stone edit, alignment + compositing, video jobs |

The website finds the API through `VITE_API_URL`, set in the committed
[`.env.production`](../.env.production) (it is a public URL, not a secret):

```
VITE_API_URL=https://api-production-2668b.up.railway.app
```

A `VITE_API_URL` set in the Vercel dashboard overrides it.

## Railway (API server)

Configured by [`railway.json`](../railway.json): no build step, `npm start`
(`tsx server/server.ts`), health check `GET /api/health`, restart on failure.
The service deploys automatically on every push to its connected branch.

Service variables (set in Railway → service → Variables; never commit them):

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Claude key (the OneProvider key when using OneProvider) |
| `CLAUDE_BASE_URL` | `https://api.oneprovider.dev` (omit for api.anthropic.com) |
| `CLAUDE_MODEL` / `CLAUDE_ANALYSIS_EFFORT` | `claude-opus-5` / `high` |
| `IMAGE_EDIT_BASE_URL` / `IMAGE_EDIT_API_KEY` | OpenAI-compatible gateway serving Gemini image models (OneProvider) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Used to verify the user's login token on every request |
| `CLIENT_URL` | Allowed website origins, comma-separated; `*` is a wildcard, e.g. `https://stonesightainew*.vercel.app,https://stonesightai.xyz` |

`PORT` is provided by Railway. Do **not** set `MCP_TEST_MODE` in production —
it disables login checks.

Check it is up: `curl https://api-production-2668b.up.railway.app/api/health`
should list `"analysis":"claude"` and `"image":["gemini-image"]`.

## After merging to `main`

The Railway service currently follows the `claude/sharp-cerf-q91vrf` branch.
After the PR is merged, switch it to `main` (Railway → service → Settings →
Source → Branch) so production deploys from `main` like the website.
