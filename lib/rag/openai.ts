/**
 * Génération de réponses RAG via l’API OpenAI (Chat Completions).
 * Contexte = chunks récupérés ; historique = N derniers messages (multi-tours).
 * Support streaming pour affichage progressif côté client.
 * Utilise le client partagé lib/openai.
 */

import OpenAI from "openai";
import { getOpenAIClient, RAG_MODEL } from "@/lib/openai";
import type { MatchedChunk } from "./search";
import type { DetectedLang } from "./detect-lang";

const SYSTEM_PROMPT_BASE = `Tu es un assistant qui répond aux questions en t'appuyant uniquement sur le contexte fourni (extraits de documents scientifiques).
Règles :
- Réponds uniquement à partir du contexte fourni. Si le contexte ne permet pas de répondre, dis-le clairement.
- Cite tes sources à la fin des phrases concernées avec des références [1], [2], etc., correspondant aux numéros des extraits fournis.
- Ne invente pas d'information ni de source.`;

const SYSTEM_PROMPT_GENERAL_KNOWLEDGE = `Tu es un assistant qui répond aux questions. Pour cette requête, le corpus de documents fourni est volontairement vide ou hors-sujet : l'utilisateur souhaite une réponse à partir de tes connaissances générales.
Règles :
- Tu DOIS répondre à la question de manière utile et factuelle. Ne dis jamais "Le contexte ne contient pas d'information" ou "Je ne peux pas répondre" : réponds au contraire en t'appuyant sur tes connaissances.
- Tu peux indiquer brièvement que ta réponse ne provient pas du corpus (ex. "D'après mes connaissances générales…") puis donne la réponse.
- Sois concis. Ne cite pas de numéros [1], [2].`;

function systemPromptWithLang(lang: DetectedLang, allowGeneralKnowledge: boolean): string {
  const base = allowGeneralKnowledge ? SYSTEM_PROMPT_GENERAL_KNOWLEDGE : SYSTEM_PROMPT_BASE;
  const langInstruction = lang === "fr" ? "Réponds en français." : "Réponds en anglais.";
  return `${base}\n- ${langInstruction}`;
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
  lang: DetectedLang = "en",
  allowGeneralKnowledge = false
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const context =
    allowGeneralKnowledge || chunks.length === 0
      ? "Aucun extrait pertinent dans le corpus pour cette question."
      : buildContext(chunks);
  const generalInstruction = allowGeneralKnowledge
    ? "Réponds à la question ci-dessous avec tes connaissances générales (ne dis pas que le contexte ne contient pas d'information).\n\n"
    : "";
  const currentUserContent = `${generalInstruction}Contexte (extraits de documents) :\n\n${context}\n\n---\n\nQuestion : ${question}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptWithLang(lang, allowGeneralKnowledge) },
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
  lang: DetectedLang = "en",
  allowGeneralKnowledge = false
): Promise<string> {
  const client = getOpenAIClient();
  const messages = buildMessages(question, chunks, history, lang, allowGeneralKnowledge);
  LOG("generateRagAnswer", {
    messagesCount: messages.length,
    chunksCount: chunks.length,
    lang,
    allowGeneralKnowledge,
    model: RAG_MODEL,
  });

  const response = await client.chat.completions.create({
    model: RAG_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  const choice = response.choices[0];
  if (!choice?.message?.content) {
    throw new Error("OpenAI returned no content");
  }
  LOG("generateRagAnswer done", {
    contentLength: choice.message.content.length,
    usage: response.usage,
  });
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
  lang: DetectedLang = "en",
  allowGeneralKnowledge = false
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const client = getOpenAIClient();
  const messages = buildMessages(question, chunks, history, lang, allowGeneralKnowledge);
  LOG("createRagAnswerStream", {
    messagesCount: messages.length,
    chunksCount: chunks.length,
    lang,
    allowGeneralKnowledge,
    model: RAG_MODEL,
  });

  const stream = await client.chat.completions.create({
    model: RAG_MODEL,
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return stream;
}
