/**
 * Client OpenAI partagé (RAG, veille, etc.).
 * Une seule source pour la clé API et la création du client.
 */

import OpenAI from "openai";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[openai]", msg, ...args);

let _client: OpenAI | null = null;

/**
 * Retourne un client OpenAI (singleton) à partir de OPENAI_API_KEY.
 * @throws si OPENAI_API_KEY est absent ou vide
 */
export function getOpenAIClient(): OpenAI {
  if (_client) {
    LOG("getOpenAIClient", "reusing existing client");
    return _client;
  }
  const apiKey = (process.env.OPENAI_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!apiKey) {
    LOG("getOpenAIClient", "OPENAI_API_KEY is not set");
    throw new Error("OPENAI_API_KEY is not set");
  }
  _client = new OpenAI({ apiKey });
  LOG("getOpenAIClient", "client created");
  return _client;
}

/** Modèle par défaut pour la veille (filtrage URLs, extraction article). */
export const VEILLE_MODEL = "gpt-4o-mini";

/** Modèle utilisé par le RAG (réponses chat). */
export const RAG_MODEL = "gpt-4o-mini";
