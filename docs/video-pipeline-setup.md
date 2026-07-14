# Stone Sight AI — Video Pipeline Architecture

Due to local hardware constraints (lack of dedicated NVIDIA/VRAM hardware) and transient NVIDIA Cloud API service states, the video generation engine runs on a **Hybrid Fallback Pipeline**.

## 1. Local / Remote NVIDIA NIM Deployment (Path A)

To run Cosmos 3 Super on a machine with a compatible NVIDIA GPU (minimum 24GB+ VRAM recommended), use the following steps:

```bash
# 1. Login to NVIDIA NGC Registry
docker login nvcr.io

# 2. Spin up the Cosmos 3 Generation NIM Container
docker run -it --rm --name=cosmos3-generator-server \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=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 \
  -e HF_TOKEN=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 \
  -p 8000:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/nvidia/cosmos3-generator:latest
```

Once running, update your root `.env` to point directly to the active port:

```env
COSMOS_INFERENCE_URL=http://localhost:8000/v1/infer
```

## 2. Serverless Cloud GPU Fallback (Path B)

If local NVIDIA hardware is unavailable, the application can automatically fall back to cloud-hosted serverless container endpoints (e.g., Replicate) to perform the rendering.

To enable this:

1. Generate an API token at [Replicate](https://replicate.com).
2. Add the token to your root `.env` file:

```env
REPLICATE_API_TOKEN=your_replicate_token_here
```

The backend server will automatically detect this key and divert traffic away from the 404-prone cloud endpoint to keep generation active.

## 3. Fallback Resolution Order

1. **Local/Tunneled NIM** — If `COSMOS_INFERENCE_URL` contains `localhost`, the server attempts a direct container request first.
2. **Serverless Cloud (Replicate)** — If the local NIM is unreachable or returns an error, and `REPLICATE_API_TOKEN` is configured, the request is routed to Replicate.
3. **Error State** — If neither path is available, the API returns a `503 Service Unavailable` with actionable guidance.

## 4. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Conditional | Required for Path A (local NIM). Ignored by Path B. |
| `COSMOS_INFERENCE_URL` | Optional | Override for local/tunneled Cosmos 3 NIM endpoint. |
| `REPLICATE_API_TOKEN` | Optional | Enables Path B serverless fallback via Replicate. |
