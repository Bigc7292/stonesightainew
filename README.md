<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# StoneSight AI — See Your Home Stone by Stone

StoneSight AI shows homeowners, designers and fabricators what **their own room** would look like with a new luxury stone surface (quartz, Dekton, marble, granite) before they buy.

The customer uploads a photo of the space (kitchen, bathroom, …), picks a stone from the collection and clicks **Generate Visualization**. One click produces:

| # | Output | How it is made |
|---|--------|----------------|
| 1 | **Static image** of the room with the new stone, with a before/after slider | Claude maps every stone surface → NVIDIA FLUX.1 Kontext edits the photo → the edit is composited back into the untouched original so only the stone changes. Without NVIDIA, the StoneSight renderer paints the swatch onto Claude's surface map in perspective. |
| 2 | **First-person walkthrough video** at human eye level (look left, look right, walk up to the stone) | NVIDIA Cosmos image-to-video with Claude's camera-motion prompt. Without Cosmos, the video is filmed in the browser along the same path through the 3D room (exactly 12 s, MP4/WebM). |
| 3 | **Interactive 3D walkthrough** — click, look around, walk with W/A/S/D, jump to each corner | The room is reconstructed in 3D from Claude's geometry (camera, walls, counter tops, waterfalls) and textured by projecting the generated image with visibility; stone slabs use the real swatch with a polished sheen. |

**AI providers: Anthropic Claude and NVIDIA only.** No other AI services are used.

## Quick start

Prerequisites: Node.js 20+ (22 recommended).

```bash
npm install
cp .env.example .env      # then fill in the keys (see below)
npm run dev:all           # frontend on :3000 + backend on :5000
```

Open http://localhost:3000, sign in (Supabase), upload a photo, pick a stone, generate.

To try the app without Supabase accounts, set `MCP_TEST_MODE=true` in `.env` **for local development only**: any email/password signs in and the API skips auth.

### Choosing a configuration

| Keys configured | Image | Video | 3D |
|-----------------|-------|-------|----|
| `ANTHROPIC_API_KEY` only | StoneSight renderer on Claude's surface map | Rendered in the browser from the 3D room | ✔ |
| Claude + `FLUX_INFERENCE_URL` (Kontext NIM) | NVIDIA Kontext + Claude precision mask | Rendered in the browser | ✔ |
| Claude + Kontext + `COSMOS_INFERENCE_URL` | NVIDIA Kontext + Claude precision mask | NVIDIA Cosmos | ✔ |
| NVIDIA only (no Claude) + `FLUX_INFERENCE_URL` | Kontext with a template prompt (no precision mask); NVIDIA VLM analysis is best effort | Cosmos if configured, else browser | ✔ (generic room if analysis fails) |

**Recommended:** `ANTHROPIC_API_KEY` (always) plus a self-hosted Kontext NIM for photoreal AI edits. NVIDIA's *hosted* image models currently accept only NVIDIA's example images, not customer photos (verified live, see [docs/image-pipeline-setup.md](docs/image-pipeline-setup.md)), so an `NVIDIA_API_KEY` alone cannot edit uploads.

Check what your keys can reach with:

```bash
npm run check:providers
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite frontend on :3000 |
| `npm run server` | Express backend on :5000 |
| `npm run dev:all` | Both together |
| `npm run build` | Production build of the frontend (`dist/`) |
| `npm run lint` | Type-checks frontend, shared code, backend and scripts |
| `npm test` | Unit + backend integration tests (fake NVIDIA & Anthropic servers, no keys needed) |
| `npm run test:e2e` | Full browser test of all three features in Chromium (screenshots + video in `tests/e2e/output/`) |
| `npm run check:providers` | Verifies the Claude key/model and NVIDIA endpoints |

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the three features work end to end
- [docs/claude-scene-analysis.md](docs/claude-scene-analysis.md) — the Claude integration, schema and prompts
- [docs/image-pipeline-setup.md](docs/image-pipeline-setup.md) — NVIDIA FLUX.1 Kontext setup and the image pipeline
- [docs/video-pipeline-setup.md](docs/video-pipeline-setup.md) — NVIDIA Cosmos setup and the browser video fallback
- [docs/3d-walkthrough.md](docs/3d-walkthrough.md) — 3D reconstruction, controls and limits
- [docs/backend.md](docs/backend.md) — API reference, environment variables, errors and logging
- [docs/deployment.md](docs/deployment.md) — hosting: website on Vercel, API server on Railway
- [rules.md](rules.md) — development workflow rules

## Project layout

```
shared/scene.ts            Scene contract shared by server and browser (+ sanitiser)
server/                    Express API (Claude + NVIDIA), see docs/backend.md
  lib/analyzers.ts         Claude vision (structured outputs) / NVIDIA VLM scene analysis
  lib/segments.ts          Set-of-mark grounding: photo regions → exact stone outlines
  lib/imageEditor.ts       NVIDIA FLUX.1 Kontext (self-hosted NIM, hosted NVCF)
  lib/nvidia.ts            NIM/NVCF client: 202 polling, asset upload, response parsing
  lib/prompts.ts           Every AI prompt, in one reviewable place
  routes/                  /api/health, /api/analyze, /api/image, /api/video
src/
  App.tsx                  Upload → stone selection → results (image, video, 3D)
  render/                  Homography + Claude-guided stone renderer / compositor
  scene/                   3D reconstruction, three.js scene, controls, video recorder
  components/              RoomWalkthrough3D, BeforeAfterSlider, GenerationGallery
tests/                     node:test suites, fixtures, Playwright E2E runner
scripts/check-providers.ts Provider diagnostics
```
