/**
 * Génération de réponses RAG via l’API OpenAI (Chat Completions).
 * Contexte = chunks récupérés ; historique = N derniers messages (multi-tours).
 * Support streaming pour affichage progressif côté client.
 */

import OpenAI from "openai";
import type { MatchedChunk } from "./search";
import type { DetectedLang } from "./detect-lang";

const SYSTEM_PROMPT_BASE = `Tu es un assistant qui répond aux questions en t'appuyant uniquement sur le contexte fourni (extraits de documents scientifiques).
Règles :
- Réponds uniquement à partir du contexte fourni. Si le contexte ne permet pas de répondre, dis-le clairement.
- Cite tes sources à la fin des phrases concernées avec des références [1], [2], etc., correspondant aux numéros des extraits fournis.
- Ne invente pas d'information ni de source.`;

function systemPromptWithLang(lang: DetectedLang): string {
  const langInstruction = lang === "fr" ? "Réponds en français." : "Réponds en anglais.";
  return `${SYSTEM_PROMPT_BASE}\n- ${langInstruction}`;
}

function buildContext(chunks: MatchedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (document: ${c.doc_title ?? "sans titre"}, section: ${c.section_title ?? "—"})\n${c.content}`
    )
    .join("\n\n");
}

export type HistoryMessage = { role: "user" | "assistant"; content: string };

function buildMessages(
  question: string,
  chunks: MatchedChunk[],
  history: HistoryMessage[],
  lang: DetectedLang = "en"
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const context = buildContext(chunks);
  const currentUserContent = `Contexte (extraits de documents) :\n\n${context}\n\n---\n\nQuestion : ${question}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptWithLang(lang) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: currentUserContent },
  ];
  return messages;
}

const LOG = (msg: string, ...args: unknown[]) => console.log("[RAG/openai]", msg, ...args);

/**
 * Appelle l’API OpenAI avec le contexte (chunks) et la question.
 * Retourne le contenu du message assistant (réponse avec citations [1], [2]…).
 * Utilisé quand on ne stream pas (ex. garde-fou ou fallback).
 */
export async function generateRagAnswer(
  question: string,
  chunks: MatchedChunk[],
  history: HistoryMessage[] = [],
  lang: DetectedLang = "en"
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const messages = buildMessages(question, chunks, history, lang);
  LOG("generateRagAnswer", { messagesCount: messages.length, chunksCount: chunks.length, lang });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  const choice = response.choices[0];
  if (!choice?.message?.content) {
    throw new Error("OpenAI returned no content");
  }
  LOG("generateRagAnswer done", { contentLength: choice.message.content.length });
  return choice.message.content;
}

/**
 * Retourne un flux OpenAI (stream) pour la réponse RAG avec historique.
 * Le consommateur peut faire for await (const chunk of stream) et extraire chunk.choices[0]?.delta?.content.
 */
export async function createRagAnswerStream(
  question: string,
  chunks: MatchedChunk[],
  history: HistoryMessage[] = [],
  lang: DetectedLang = "en"
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const messages = buildMessages(question, chunks, history, lang);
  LOG("createRagAnswerStream", { messagesCount: messages.length, chunksCount: chunks.length, lang });

  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return stream;
}
