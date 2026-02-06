/**
 * Embedding de la requête utilisateur (384D).
 * Même modèle que l'ingestion : sentence-transformers all-MiniLM-L6-v2 (Xenova/all-MiniLM-L6-v2).
 * Utilisé côté serveur uniquement (API route / server action).
 */

import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getExtractor() {
  if (extractor) return extractor;
  console.log("[RAG/embed] Loading model", MODEL);
  extractor = await pipeline("feature-extraction", MODEL, {
    quantized: true,
  });
  console.log("[RAG/embed] Model loaded");
  return extractor;
}

/**
 * Embed un texte (ex. requête utilisateur). Retourne un vecteur 384D.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const ex = await getExtractor();
  const out = await ex(text, { pooling: "mean", normalize: true });
  const arr = Array.from(out.data as Float32Array);
  if (arr.length !== DIM) throw new Error(`Expected embedding dim ${DIM}, got ${arr.length}`);
  return arr;
}

/**
 * Embed plusieurs textes en un batch (optionnel, pour recherche multi-requêtes).
 */
export async function embedQueries(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: "mean", normalize: true });
  const dim = out.dims[out.dims.length - 1] as number;
  const batchSize = out.dims[0] as number;
  const data = out.data as Float32Array;
  const result: number[][] = [];
  for (let i = 0; i < batchSize; i++) {
    result.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return result;
}
