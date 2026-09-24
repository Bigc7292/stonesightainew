# StoneSight AI — Architecture

StoneSight turns **one room photo + one stone choice** into three deliverables: a
photoreal static image, a first-person walkthrough video and an interactive 3D
walkthrough. **Anthropic Claude** does the understanding and planning (surface
map, prompts, masks); a **Gemini image model** (via an OpenAI-compatible gateway)
or an **NVIDIA FLUX.1 Kontext NIM** does the photoreal countertop edit, which is
aligned and composited back into the original photo; **NVIDIA Cosmos** optionally
makes the video. Every stage has a deterministic fallback, so the app keeps
working when an editor is not available. See [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)
for the full history and status.

## End-to-end flow

```
 Browser (React, Vite :3000)                          Backend (Express :5000)
 ─────────────────────────────                        ──────────────────────────
 1. Upload photo ──► fileToDataUrl (EXIF-rotate, ≤1600 px JPEG)
 2. Pick stone  ──► loadSwatch (trim catalogue margins)
 3. Generate:
    GET  /api/health ───────────────────────────────► which providers exist
    POST /api/analyze {photo, swatch, stone} ───────► Claude vision (structured outputs)
                                                       + grounding: Claude picks numbered photo regions
                                      ◄─────────────── SceneAnalysis (shared/scene.ts)
    ┌─ NVIDIA image available?
    │  yes: POST /api/image/generate {photo, Claude edit_instruction}
    │        ──────────────────────────────────────► FLUX.1 Kontext NIM (image-to-image)
    │        ◄─ edited photo ── compositeEdit(original, edited, Claude polygons)
    │  no:  renderStone(original, swatch, Claude surfaces)   (in the browser)
    └─► ① STATIC IMAGE
    ┌─ ③ 3D WALKTHROUGH: buildRoomLayout(scene) → RoomScene (three.js) + FirstPersonController
    └─ ② VIDEO:
       NVIDIA Cosmos configured?
         yes: POST /api/video/generate → job → GET /api/video/status/:id ──► Cosmos NIM
         no / failed: recordWalkthrough (same 3D scene, scripted eye-level path, WebCodecs)
```

## The scene analysis is the backbone

`POST /api/analyze` asks Claude to measure the photo, then snaps every stone
outline to real image edges by having Claude pick numbered photo regions
(set-of-mark grounding; [details](claude-scene-analysis.md)). The response (`SceneAnalysis`) contains:

| Field | Used by |
|-------|---------|
| `surfaces[]` — every stone surface as a plane quad + visible polygon + real size (m) | image compositor mask, local stone renderer, 3D slabs & waterfall panels |
| `camera` — horizontal FOV, eye height, pitch | 3D reconstruction, projective texturing |
| `back_wall` — floor/ceiling corners of the far wall | 3D room box ("Tour Into the Picture") |
| `room_estimate` — width, depth, ceiling, space behind camera | 3D fallback geometry, behind-camera space |
| `colors` — walls, floor, ceiling, cabinets | 3D surfaces the photo never saw |
| `edit_instruction` | NVIDIA FLUX.1 Kontext prompt |
| `video_prompt` | NVIDIA Cosmos prompt (first-person, eye level) |

`shared/scene.ts#sanitizeScene` clamps every value to a plausible range and
drops degenerate surfaces, so a slightly wrong estimate can never crash a
renderer.

## Feature 1 — static image (`src/render/`)

- **NVIDIA path.** Kontext is an *image editing* model: the customer's photo is
  sent as the input image with Claude's instruction (which describes the
  chosen stone concretely, because Kontext never sees the swatch). The result
  is then **composited**: `compositeEdit` keeps the original photo everywhere
  except inside Claude's stone polygons (dilated ~1.2 %, feathered). The room,
  cabinets, lighting and objects are therefore byte-identical to the upload —
  this fixes the earlier bug where the old text-to-image model generated a
  completely different room.
- **Local path (no NVIDIA).** `renderStone` maps the unit square of each slab
  onto its quad with a homography, samples the swatch in metres (mirrored
  repeat, 0.9 m per tile), and transfers the photo's lighting through a
  heavily blurred luminance ratio plus strong specular highlights. The old
  stone's pattern is not carried over; shadows and light fall-off are.

## Feature 2 — first-person video

- **NVIDIA Cosmos** (`server/routes/video.ts`): an async job (videos take
  minutes) posts the generated image + Claude's `video_prompt` + a negative
  prompt to the Cosmos NIM, then stores the MP4 under `public/videos/`.
- **Browser fallback** (`src/scene/recordWalkthrough.ts`): the 3D scene is
  rendered along `walkthroughPath.ts` — stand at the photo position, look left,
  pan right across the room, walk (collision-free) up to the main stone surface
  and tilt down to its grain, all at the photographer's eye height with a
  subtle head bob. Frames are encoded with WebCodecs at exact timestamps
  (H.264/MP4, or VP9/WebM where H.264 encoding is unavailable), so the clip is
  always 12 s at 30 fps however fast the GPU is. Old browsers fall back to
  MediaRecorder.

## Feature 3 — interactive 3D walkthrough (`src/scene/`, [details](3d-walkthrough.md))

`buildRoomLayout` reconstructs metric geometry: floor/back wall/side walls/
ceiling, stone slabs with cabinet bases, waterfall and backsplash panels,
obstacle footprints and viewpoints (photo view, four corners, stone close-up).
`RoomScene` projects the generated image from the original camera onto that
geometry with a depth pre-pass, so each surface shows the photo only where the
photo actually saw it. `FirstPersonController` provides pointer-lock mouse
look, W/A/S/D walking with collision and sliding, Q/E turning, touch controls,
animated jumps and a clickable mini-map.

## Degradation matrix

| Situation | Behaviour |
|-----------|-----------|
| No analyser (no Claude, no NVIDIA key) | NVIDIA Kontext still edits the photo if configured (template prompt, no mask); otherwise a clear configuration error |
| Claude fails | NVIDIA VLM is tried (if `NVIDIA_API_KEY`); otherwise continue with a template prompt |
| Kontext not configured / fails | Local Claude-guided renderer |
| Hosted Kontext rejects custom images (preview keys) | Detected once (422 `example_id`), hosted path disabled for the process |
| Cosmos not configured / fails | Browser-rendered walkthrough video |
| No WebGL | 3D panel shows an explanatory message; image still works |

## Security

- API keys live only in the backend `.env`; the browser never sees them.
- All `/api/*` routes except `/api/health` require a Supabase access token.
- Logs mask secrets (`maskSecret`) and never print image payloads.
