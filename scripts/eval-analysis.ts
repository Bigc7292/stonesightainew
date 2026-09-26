/**
 * Prompt-evaluation harness for the scene analysis.
 *
 * Runs the real analysis (Claude first pass + grounding) on one or more room
 * photos and writes, per photo:
 *   <name>-1-claude.jpg     Claude's first-pass outlines, quads and back wall
 *   <name>-2-regions.jpg    the numbered regions Claude saw in the grounding pass
 *   <name>-3-final.jpg      final outlines after grounding
 *   <name>-4-render.jpg     the stone rendered with the local renderer
 *   <name>-5-edit-raw.jpg   the raw generative edit (when an image editor is configured)
 *   <name>-6-final.jpg      the edit aligned + composited into the original (what users see)
 *   <name>.json             first-pass scene, grounding reply, final scene, timings
 *
 * Usage:
 *   npm run eval:analysis -- <photo|dir>... [--stone "Dekton Trilium"] [--out dir]
 * Needs ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL for a gateway) in .env.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { analyzeScene } from "../server/lib/analyzers";
import { drawSceneOverlay, toJpeg } from "../server/lib/images";
import { renderStone, type Pixels } from "../src/render/stoneRenderer";
import { editStone, imageEditProviders } from "../server/lib/imageEditor";
import { compositeStoneEdit } from "../server/lib/composite";
import { STONE_DATABASE as stones } from "../src/stones";
import { findContentRect } from "../src/lib/imageUtils";
import type { SceneAnalysis } from "../shared/scene";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const stoneName = opt("stone", "Dekton Trilium");
const outDir = path.resolve(opt("out", "eval-output"));
const flags = args.filter((a) => a.startsWith("--"));
const inputs = args.filter((a) => !a.startsWith("--")).flatMap((a) =>
  fs.statSync(a).isDirectory()
    ? fs.readdirSync(a).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => path.join(a, f))
    : [a],
);
if (inputs.length === 0) {
  console.error("usage: npm run eval:analysis -- <photo|dir>... [--stone name] [--out dir]");
  process.exit(1);
}

const found = stones.find((s) => s.name === stoneName);
if (!found) throw new Error(`unknown stone "${stoneName}"`);
const stone = found;

async function pixels(buf: Buffer, width?: number, height?: number): Promise<Pixels> {
  const img = sharp(buf).rotate();
  const { data, info } = await (width ? img.resize(width, height, { fit: "fill" }) : img)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const swatchBuf = fs.readFileSync(path.join(__dirname, "..", "public", stone.swatchUrl));
  // Trim catalogue letterboxing exactly like the app's loadSwatch().
  const raw = await pixels(swatchBuf);
  const r = findContentRect(raw.data, raw.width, raw.height);
  const swatch = await pixels(await sharp(swatchBuf).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).toBuffer());
  for (const file of inputs) {
    const name = path.basename(file).replace(/\.[^.]+$/, "");
    const photo = fs.readFileSync(file);
    const view = await toJpeg(photo, 1280, 88);
    const stages: Record<string, unknown> = {};
    const t0 = Date.now();
    try {
      const result = await analyzeScene({
        photo,
        swatch: swatchBuf,
        stone,
        trace: (stage, data) => {
          if (stage === "segments") {
            const d = data as { image: Buffer; count: number };
            fs.writeFileSync(path.join(outDir, `${name}-2-regions.jpg`), d.image);
            stages.regions = d.count;
          } else stages[stage] = data;
        },
      });
      const secs = (Date.now() - t0) / 1000;
      const first = stages.claude as SceneAnalysis | undefined;
      if (first) fs.writeFileSync(path.join(outDir, `${name}-1-claude.jpg`), await drawSceneOverlay(view.buffer, view.width, view.height, first));
      fs.writeFileSync(path.join(outDir, `${name}-3-final.jpg`), await drawSceneOverlay(view.buffer, view.width, view.height, result.analysis));
      const rendered = renderStone(await pixels(view.buffer), swatch, result.analysis);
      await sharp(Buffer.from(rendered.data.buffer), { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
        .jpeg({ quality: 88 })
        .toFile(path.join(outDir, `${name}-4-render.jpg`));
      let edit: Record<string, unknown> | undefined;
      if (!flags.includes("--no-edit") && imageEditProviders().length > 0) {
        const t1 = Date.now();
        try {
          const e = await editStone({ photo, swatch: swatchBuf, stone, instruction: result.analysis.edit_instruction });
          fs.writeFileSync(path.join(outDir, `${name}-5-edit-raw.jpg`), await sharp(e.buffer).jpeg({ quality: 90 }).toBuffer());
          const c = await compositeStoneEdit(photo, e.buffer, result.analysis, swatchBuf);
          fs.writeFileSync(path.join(outDir, `${name}-6-final.jpg`), c.buffer);
          edit = { provider: e.provider, model: e.model, secs: (Date.now() - t1) / 1000, alignment: c.alignment, editedFraction: c.editedFraction };
        } catch (error) {
          edit = { error: error instanceof Error ? error.message : String(error) };
        }
      }
      fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ secs, model: result.model, ...stages, final: result.analysis, edit }, null, 2));
      console.log(`✔ ${name}: ${result.analysis.surfaces.length} surfaces in ${secs.toFixed(0)} s (${result.analyzer}/${result.model})${edit ? ` · edit ${JSON.stringify(edit).slice(0, 160)}` : ""}`);
    } catch (error) {
      console.log(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Outputs in ${outDir}`);
}

main();
