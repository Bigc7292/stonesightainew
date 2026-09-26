/**
 * Helper for the Claude Code analyst (server/lib/claudeCodeAnalyst.ts).
 *
 *   npm run analyst -- list                    pending jobs
 *   npm run analyst -- preview <id> <draft>    draw a draft answer → <job>/preview.jpg
 *   npm run analyst -- answer <id> <draft>     submit the draft as answer.json
 *   npm run analyst -- at <id> x,y [x,y…]      region ids under normalised points
 *
 * A draft is a JSON file in the answer format ({ top: [...], face: [...], … }).
 */
import fs from "node:fs";
import path from "node:path";
import { analystDir, drawAnswerPreview, sceneFromAnswer, segmentJobPhoto, type AnalystAnswer } from "../server/lib/claudeCodeAnalyst";

async function main() {
  const [cmd, id, draftPath] = process.argv.slice(2);
  const inbox = path.join(analystDir(), "inbox");
  if (cmd === "list" || !cmd) {
    const jobs = fs.existsSync(inbox) ? fs.readdirSync(inbox) : [];
    for (const j of jobs) {
      const answered = fs.existsSync(path.join(inbox, j, "answer.json"));
      const req = JSON.parse(fs.readFileSync(path.join(inbox, j, "request.json"), "utf8"));
      console.log(`${answered ? "done   " : "PENDING"} ${j}  ${req.stone?.name ?? ""}  ${req.regions} regions  ${path.join(inbox, j)}`);
    }
    if (!jobs.length) console.log("no jobs");
    return;
  }
  if (cmd === "at") {
    const seg = await segmentJobPhoto(path.join(inbox, id, "photo.jpg"));
    for (const pt of process.argv.slice(4)) {
      const [x, y] = pt.split(",").map(Number);
      console.log(`${pt} → region ${seg.labels[Math.min(seg.height - 1, Math.floor(y * seg.height)) * seg.width + Math.min(seg.width - 1, Math.floor(x * seg.width))]}`);
    }
    return;
  }
  if (!id || !draftPath) throw new Error("usage: analyst preview|answer <id> <draft.json>");
  const dir = path.join(inbox, id);
  const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as AnalystAnswer;
  const seg = await segmentJobPhoto(path.join(dir, "photo.jpg"));
  const scene = sceneFromAnswer(seg, draft, "preview");
  console.log(scene.surfaces.map((s) => `${s.id} ${s.orientation} ${s.polygon.length} pts`).join("\n") || "no surfaces");
  if (cmd === "preview") {
    fs.writeFileSync(path.join(dir, "preview.jpg"), await drawAnswerPreview(path.join(dir, "photo.jpg"), seg, draft));
    console.log(`wrote ${path.join(dir, "preview.jpg")}`);
  } else if (cmd === "answer") {
    fs.writeFileSync(path.join(dir, "answer.json.tmp"), JSON.stringify(draft, null, 2));
    fs.renameSync(path.join(dir, "answer.json.tmp"), path.join(dir, "answer.json"));
    console.log(`answered ${id}`);
  } else throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
