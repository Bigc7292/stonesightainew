/**
 * Verifies the AI provider configuration without generating anything:
 *   - Claude: the API key is valid and the configured model exists.
 *   - NVIDIA: the API key can list models; the self-hosted FLUX Kontext and
 *     Cosmos endpoints are reachable.
 *
 * Usage: npm run check:providers
 */
import Anthropic from "@anthropic-ai/sdk";
import { config, maskSecret } from "../server/lib/env";

type Result = { name: string; ok: boolean | null; detail: string };
const results: Result[] = [];
const record = (name: string, ok: boolean | null, detail: string) => results.push({ name, ok, detail });

async function checkClaude() {
  const key = config.anthropicApiKey();
  if (!key) {
    record("Claude (scene analysis)", null, "ANTHROPIC_API_KEY not set — Claude analysis disabled");
    return;
  }
  try {
    const client = new Anthropic({ apiKey: key });
    const model = await client.models.retrieve(config.claudeModel());
    record("Claude (scene analysis)", true, `${model.id} available (key ${maskSecret(key)})`);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) record("Claude (scene analysis)", false, "ANTHROPIC_API_KEY rejected");
    else if (error instanceof Anthropic.NotFoundError) record("Claude (scene analysis)", false, `model ${config.claudeModel()} not found — check CLAUDE_MODEL`);
    else record("Claude (scene analysis)", false, error instanceof Error ? error.message : String(error));
  }
}

async function checkNvidiaKey() {
  const key = config.nvidiaApiKey();
  if (!key) {
    record("NVIDIA API key", null, "NVIDIA_API_KEY not set — hosted NVIDIA endpoints disabled");
    return;
  }
  try {
    const res = await fetch(`${config.nvidiaBaseUrl()}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      record("NVIDIA API key", false, `models endpoint returned ${res.status}`);
      return;
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id);
    const vlms = config.nvidiaVlmModels().map((m) => `${m} ${ids.includes(m) ? "listed" : "NOT listed"}`);
    record("NVIDIA API key", true, `${ids.length} models visible; VLM analysers: ${vlms.join(", ")}`);
  } catch (error) {
    record("NVIDIA API key", false, error instanceof Error ? error.message : String(error));
  }
}

async function ping(name: string, url: string, envName: string) {
  if (!url) {
    record(name, null, `${envName} not set`);
    return;
  }
  try {
    // A bare GET is enough to prove the container/tunnel answers (NIMs return 404/405 for GET on /v1/infer).
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    record(name, true, `${url} reachable (HTTP ${res.status})`);
  } catch (error) {
    record(name, false, `${url} unreachable: ${error instanceof Error ? error.message : error}`);
  }
}

(async () => {
  await Promise.all([
    checkClaude(),
    checkNvidiaKey(),
    ping("NVIDIA FLUX.1 Kontext (self-hosted)", config.fluxInferenceUrl(), "FLUX_INFERENCE_URL"),
    ping("NVIDIA Cosmos (video)", config.cosmosInferenceUrl(), "COSMOS_INFERENCE_URL"),
  ]);
  for (const r of results) {
    console.log(`${r.ok === true ? "✔" : r.ok === false ? "✘" : "–"} ${r.name}: ${r.detail}`);
  }
  console.log(
    "\nFallbacks: without NVIDIA image editing the app renders stone locally from Claude's analysis;" +
      " without Cosmos it records the walkthrough video in the browser from the 3D scene.",
  );
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
})();
