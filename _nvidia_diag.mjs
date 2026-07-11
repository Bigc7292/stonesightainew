import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), "server", ".env"), override: true });

const KEY = process.env.NVIDIA_API_KEY || "";
const URL = "https://integrate.api.nvidia.com/v1/models";

async function main() {
  const res = await fetch(URL, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const data = await res.json();
  const models = data.data || [];

  const imageVideoModels = models.filter((m: any) => {
    const id = m.id.toLowerCase();
    return id.includes("flux") || id.includes("stable") || id.includes("imagen") || 
           id.includes("sdxl") || id.includes("dall") || id.includes("genimg") ||
           id.includes("video") || id.includes("cosmos") || id.includes("imagen");
  });

  console.log("Image/Video models available:\n");
  imageVideoModels.forEach((m: any) => console.log(`  ${m.id}`));

  if (imageVideoModels.length === 0) {
    console.log("  (none found)");
    console.log("\nAll models containing 'img', 'gen', 'video', 'flux', 'sd', 'stability':");
    models.filter((m: any) => {
      const id = m.id.toLowerCase();
      return id.includes("img") || id.includes("gen") || id.includes("video") || 
             id.includes("flux") || id.includes("sd") || id.includes("stability") ||
             id.includes("black") || id.includes("nVID") || id.includes("google");
    }).forEach((m: any) => console.log(`  ${m.id}`));
  }
}
main();