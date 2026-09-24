/**
 * Generative stone edit with Gemini image models ("Nano Banana") through an
 * OpenAI-compatible gateway (chat completions with image output), e.g.
 * OneProvider. Unlike FLUX Kontext, Gemini receives the stone swatch as a
 * second image, so it can reproduce the exact material.
 *
 * The raw edit is never shown as-is: the image route aligns it to the
 * original photo and composites only the stone back in (see composite.ts).
 */
import { config } from "./env";
import { sniffImageMime, toJpeg } from "./images";

export class ImageEditError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export function geminiImageConfigured(): boolean {
  return !!config.imageEditBaseUrl() && !!config.imageEditApiKey();
}

/** Pulls the first image out of a chat-completions reply (markdown data URL, parts, or images[]). */
export function extractChatImage(data: any): Buffer | null {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return null;
  const candidates: string[] = [];
  const pushUrl = (u: unknown) => typeof u === "string" && candidates.push(u);
  if (Array.isArray(msg.images)) msg.images.forEach((im: any) => pushUrl(im?.image_url?.url ?? im?.url));
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      pushUrl(part?.image_url?.url);
      if (part?.inline_data?.data) candidates.push(`data:${part.inline_data.mime_type};base64,${part.inline_data.data}`);
      if (typeof part?.text === "string") candidates.push(part.text);
    }
  } else if (typeof msg.content === "string") candidates.push(msg.content);
  for (const c of candidates) {
    const m = /data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)/.exec(c);
    if (m) return Buffer.from(m[1], "base64");
  }
  return null;
}

export interface GeminiEditResult {
  buffer: Buffer;
  mime: string;
  model: string;
}

/** Edits `photo` with the first image model that answers. */
export async function editWithGemini(photo: Buffer, swatch: Buffer | undefined, prompt: string): Promise<GeminiEditResult> {
  if (!geminiImageConfigured()) throw new ImageEditError("IMAGE_EDIT_BASE_URL / IMAGE_EDIT_API_KEY not set", 503);
  const room = await toJpeg(photo, 1536, 92);
  const content: unknown[] = [
    { type: "text", text: "Image 1 — the customer's room photo to edit:" },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${room.buffer.toString("base64")}` } },
  ];
  if (swatch) {
    const sw = await toJpeg(swatch, 768, 90);
    content.push(
      { type: "text", text: "Image 2 — a sample of the stone to install (reference only, do not paste it as a picture):" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${sw.buffer.toString("base64")}` } },
    );
  }
  content.push({ type: "text", text: prompt });

  const errors: string[] = [];
  for (const model of config.imageEditModels()) {
    const delays = [5_000, 15_000]; // gateway 503s are usually brief capacity blips
    for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
      try {
        const res = await fetch(`${config.imageEditBaseUrl()}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.imageEditApiKey()}` },
          body: JSON.stringify({ model, modalities: ["image", "text"], messages: [{ role: "user", content }] }),
          signal: AbortSignal.timeout(180_000),
        });
        const text = await res.text();
        if (!res.ok) {
          // Gateways answer 503 while a model is warming up / over capacity.
          if ((res.status === 503 || res.status === 429) && attempt <= delays.length) {
            console.warn("[IMAGE] Gemini busy, retrying", { model, status: res.status, attempt });
            await new Promise((r) => setTimeout(r, delays[attempt - 1]));
            continue;
          }
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const buffer = extractChatImage(JSON.parse(text));
        if (!buffer) throw new Error(`no image in reply: ${text.slice(0, 200)}`);
        console.log("[IMAGE] Gemini edit succeeded", { model, bytes: buffer.length });
        return { buffer, mime: sniffImageMime(buffer), model };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[IMAGE] Gemini model failed", { model, attempt, message });
        errors.push(`${model}: ${message}`);
        break;
      }
    }
  }
  throw new ImageEditError(errors.join(" | "), 502);
}
