/**
 * Embedding de la requête utilisateur (384D).
 * Même modèle que l'ingestion : sentence-transformers all-MiniLM-L6-v2 (Xenova/all-MiniLM-L6-v2).
 * Utilisé côté serveur uniquement (API route / server action).
 * Sur Vercel (serverless), le filesystem est en lecture seule : on redirige le cache vers /tmp.
 */

import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

// Vercel : filesystem du déploiement en lecture seule ; passer cache_dir dans les options du pipeline
const PIPELINE_OPTS: { quantized: boolean; cache_dir?: string } = { quantized: true };
if (typeof process !== "undefined" && process.env?.VERCEL === "1") {
  PIPELINE_OPTS.cache_dir = "/tmp/transformers-cache";
}

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getExtractor() {
  if (extractor) return extractor;
  console.log("[RAG/embed] Loading model", MODEL);
  extractor = await pipeline("feature-extraction", MODEL, PIPELINE_OPTS);
  console.log("[RAG/embed] Model loaded");
  return extractor;
}

// Options supportées à l'exécution par le modèle feature-extraction ; les types @xenova/transformers sont trop stricts
const EMBED_OPTIONS = { pooling: "mean", normalize: true } as const;

/** Retour du pipeline feature-extraction : tensor avec .data et .dims */
type EmbeddingTensor = { data: Float32Array; dims: number[] };

/**
 * Embed un texte (ex. requête utilisateur). Retourne un vecteur 384D.
 */
// Options supportées à l'exécution par le modèle feature-extraction ; les types @xenova/transformers sont trop stricts
const EMBED_OPTIONS = { pooling: "mean", normalize: true } as const;

/** Retour du pipeline feature-extraction : tensor avec .data et .dims */
type EmbeddingTensor = { data: Float32Array; dims: number[] };

export async function embedQuery(text: string): Promise<number[]> {
  const ex = await getExtractor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types pipeline feature-extraction trop stricts
  const out = (await ex(text, EMBED_OPTIONS as any)) as EmbeddingTensor;
  const arr = Array.from(out.data);
  if (arr.length !== DIM) throw new Error(`Expected embedding dim ${DIM}, got ${arr.length}`);
  return arr;
}

/**
 * Embed plusieurs textes en un batch (optionnel, pour recherche multi-requêtes).
 */
export async function embedQueries(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ex = await getExtractor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types pipeline feature-extraction trop stricts (batch)
  const out = (await (ex as any)(texts, EMBED_OPTIONS)) as EmbeddingTensor;
  const dim = out.dims[out.dims.length - 1] as number;
  const batchSize = out.dims[0] as number;
  const data = out.data;
  const result: number[][] = [];
  for (let i = 0; i < batchSize; i++) {
    result.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return result;
}
