# Video Pipeline — First-Person Walkthrough

The video shows the new space **as if through the customer's own eyes**: eye
level (~1.6 m), steady gimbal-style motion, looking left, then right across the
room, then walking up to the main stone surface and tilting down to its grain.

Two engines produce it:

| Engine | When | Output |
|--------|------|--------|
| **NVIDIA Cosmos** image-to-video NIM | `COSMOS_INFERENCE_URL` is set | MP4 from Cosmos, saved to `public/videos/`, served at `/videos/…` |
| **Browser renderer** (3D scene) | Cosmos not configured or the job failed | 12 s, 30 fps MP4 (H.264) or WebM (VP9/VP8), 1280×720 (960×540 without a GPU) |

## NVIDIA Cosmos

### Deploy

Cosmos needs a large NVIDIA GPU (≥48 GB VRAM recommended; H100/A100 80 GB for
the larger models). Pull the Cosmos image-to-video (Video2World) NIM that your
NGC account has access to — this project previously used
`nvcr.io/nim/nvidia/cosmos3-generator:latest`:

```bash
docker login nvcr.io            # username: $oauthtoken, password: <your NGC API key>

docker run -it --rm --name=cosmos \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=<your-ngc-api-key> \
  -e HF_TOKEN=<your-huggingface-token> \
  -p 8000:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/nvidia/cosmos3-generator:latest
```

```env
COSMOS_INFERENCE_URL=http://<gpu-host>:8000/v1/infer
# Optional: model-specific request fields from the NIM's API reference
COSMOS_EXTRA_PARAMS={"num_frames":121}
```

`COSMOS_INFERENCE_URL` may also be an NVCF-hosted invoke URL; the request then
carries `Authorization: Bearer $NVIDIA_API_KEY` and `202` responses are polled
automatically.

### Request / response (`server/routes/video.ts`)

```json
{
  "prompt": "<Claude video_prompt — first-person, eye-level walkthrough>",
  "negative_prompt": "people, hands, text, watermark, … camera shake",
  "image": "data:image/jpeg;base64,<generated stone image, ≤1280 px>",
  "seed": 123,
  "...": "COSMOS_EXTRA_PARAMS"
}
```

Accepted responses: `b64_video`, `video_b64`, `artifacts[0].base64`, or a
`video` / `outputs[0]` URL (downloaded and stored locally).

Because Cosmos takes minutes, the API is asynchronous:

```
POST /api/video/generate      → 202 { jobId }
GET  /api/video/status/:jobId → { status: queued|running|succeeded|failed, videoUrl?, error? }
```

The frontend polls every 5 s for up to 20 minutes. Jobs are kept in memory for
an hour (per user); use Redis or a database table if you run several server
instances.

## Browser renderer (`src/scene/recordWalkthrough.ts`)

- Uses the same reconstructed 3D room as the interactive walkthrough.
- Camera path (`src/scene/walkthroughPath.ts`): photo position → look left 32°
  → pan right 30° while stepping in → walk (collision-checked) to the stone
  close-up viewpoint → tilt down, slow pan across the slab. Eye height stays
  at the photographer's height with a subtle walking bob.
- Encoding: WebCodecs via `mediabunny` with exact frame timestamps, so the
  clip is always 12 s regardless of GPU speed; H.264/MP4 when the browser can
  encode it, else VP9/VP8 WebM; MediaRecorder as a last resort.
- Performance: a few seconds on a normal GPU. Without a GPU (software WebGL,
  e.g. some VMs/CI) it drops to 960×540 and can take a few minutes.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Notice "NVIDIA Cosmos video unavailable (…)" | Read the message and the `[VIDEO]` server logs; check the container is running and `COSMOS_INFERENCE_URL` is reachable (`npm run check:providers`) |
| `unexpected Cosmos response keys: …` | Your NIM returns a different field — add it to `extractVideo` in `server/lib/nvidia.ts` |
| Cosmos rejects a field | Check the NIM's API reference and adjust `COSMOS_EXTRA_PARAMS` |
| "This browser cannot record video" | Use a current Chrome, Edge, Firefox or Safari |

> **Security note:** earlier versions of this document contained real NGC and
> Hugging Face tokens. They were removed, but they remain in the git history —
> **revoke and rotate them** in the NGC and Hugging Face consoles.
