# Stone Sight AI — Image Pipeline Architecture

The image generation pipeline uses NVIDIA's **FLUX.1 Kontext** model for high-fidelity, in-photo material replacement. Unlike the previous FLUX.1-dev base mode, which was text-to-image only and discarded input photos, the Kontext model performs true image-to-image editing by preserving the original room geometry, lighting, and perspective while replacing only the target stone surfaces.

## 1. Model & Endpoint

| Parameter | Value |
|-----------|-------|
| Model | `black-forest-labs/flux.1-kontext-dev` |
| Endpoint | `${NVIDIA_BASE_URL}/generation/black-forest-labs/flux.1-kontext-dev` |
| Default Base URL | `https://integrate.api.nvidia.com/v1` |
| Env Override | `NVIDIA_IMAGE_URL` |

## 2. Image Upload & Example ID

NVIDIA FLUX Kontext requires uploaded images to be registered as examples before generation. The backend performs a two-step flow:

1. **Upload**: `POST ${EXAMPLES_UPLOAD_ENDPOINT}` with the image as `multipart/form-data`
2. **Generate**: `POST ${FLUX_ENDPOINT}` with `example_id` instead of inline base64

### Upload Request
```
POST https://ai.api.nvidia.com/v1/genai/examples
Authorization: Bearer ${NVIDIA_API_KEY}
Content-Type: multipart/form-data

file: <binary image>
```

### Upload Response
```json
{
  "example_id": "abc123..."
}
```

## 3. Request Payload

The backend constructs a Kontext-compatible payload that references the uploaded example by ID:

```json
{
  "prompt": "Surgically replace all countertops with Brown Emperador Marble...",
  "example_id": "abc123...",
  "height": 1024,
  "width": 1024,
  "steps": 28,
  "cfg_scale": 5.0,
  "seed": 42
}
```

### Key Fields
- **`example_id`**: The ID returned from the examples upload endpoint
- **`prompt`**: Detailed material replacement instructions including stone name, description, veining, and lighting preservation directives
- **`steps`**: Inference steps (default 28)
- **`cfg_scale`**: Guidance scale (default 5.0)

## 3. Response Handling

NVIDIA FLUX Kontext returns edited images in one of two formats:
- **`b64_output`**: Direct base64 string of the generated PNG
- **`outputs[0]`**: Array-based output format

The backend normalizes both into a `data:image/png;base64,...` data URL for the client and persists a copy to `public/images/replaced_<timestamp>.png`.

## 4. Frontend Flow

1. User uploads a kitchen photo on the home screen
2. User selects a target stone material from the collection
3. Frontend sends `POST /api/image/generate` with:
   - `prompt`: Detailed replacement instructions
   - `image`: Base64 data URL of the uploaded photo
4. Backend uploads the image to NVIDIA's examples endpoint and receives an `example_id`
5. Backend calls FLUX.1 Kontext with the `example_id` embedded in the payload
6. Frontend receives the edited image and displays it in the Before/After slider
7. Both clockwise and counter-clockwise video walkthroughs are then generated from the edited image

## 5. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Yes | Authentication for NVIDIA NIM/GenAI endpoints |
| `NVIDIA_BASE_URL` | No | Override for NVIDIA API base URL (default: `https://integrate.api.nvidia.com/v1`) |
| `NVIDIA_IMAGE_URL` | No | Full override for the image generation endpoint |

## 6. Transition Notes

| Aspect | Previous (FLUX.1-dev) | Current (FLUX.1 Kontext) |
|--------|----------------------|--------------------------|
| Model | `black-forest-labs/flux.1-dev` | `black-forest-labs/flux.1-kontext-dev` |
| Mode | `base` (text-to-image) | img2img via example upload |
| Input Image | Ignored/discarded | Uploaded as example, referenced by `example_id` |
| Output Behavior | Generates new image from scratch | Edits existing photo in-place |
| Use Case | General text-to-image | Photorealistic material replacement |
