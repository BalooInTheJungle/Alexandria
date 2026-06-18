/**
 * Pré-télécharge le modèle Xenova/all-MiniLM-L6-v2 dans .model-cache/
 * Exécuté pendant `npm run build` pour bundler le modèle dans le déploiement Vercel.
 * Évite le téléchargement au runtime (cold start de 3-4 min → "Embedding failed").
 */

import path from "path"
import { pipeline } from "@xenova/transformers"

const cacheDir = path.join(process.cwd(), ".model-cache")

console.log("[prebuild-embed] Downloading model to", cacheDir)

try {
  await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
    cache_dir: cacheDir,
  } as object)
  console.log("[prebuild-embed] Model cached successfully")
} catch (err) {
  console.error("[prebuild-embed] Failed:", err)
  process.exit(1)
}
