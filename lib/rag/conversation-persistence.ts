/**
 * Persistance des conversations et messages (chatbot RAG).
 * Création / mise à jour de conversation, insertion des messages.
 */

import { createClient } from "@/lib/supabase/server";

const LOG = (msg: string, ...args: unknown[]) => console.log("[RAG/conversation]", msg, ...args);

/**
 * Récupère une conversation existante ou en crée une nouvelle.
 * - Si conversationId fourni et trouvé : met à jour updated_at et retourne l’id.
 * - Sinon : crée une nouvelle conversation avec le titre donné.
 */
export async function getOrCreateConversation(
  conversationId: string | null,
  title: string
): Promise<{ id: string }> {
  const supabase = await createClient();

  if (conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .single();
    if (!error && data) {
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", data.id);
      LOG("getOrCreateConversation: existing", { id: data.id });
      return { id: data.id };
    }
  }

  const safeTitle = (title || "Nouvelle conversation").slice(0, 255);
  const { data, error } = await supabase
    .from("conversations")
    .insert({ title: safeTitle })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  if (!data?.id) throw new Error("Failed to create conversation: no id returned");
  LOG("getOrCreateConversation: created", { id: data.id, title: safeTitle });
  return { id: data.id };
}

/**
 * Insère un message (user ou assistant) et retourne son id.
 */
export async function insertMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  sources?: unknown
): Promise<{ id: string }> {
  const supabase = await createClient();
  const row: { conversation_id: string; role: string; content: string; sources?: unknown } = {
    conversation_id: conversationId,
    role,
    content,
  };
  if (sources !== undefined) row.sources = sources;

  const { data, error } = await supabase.from("messages").insert(row).select("id").single();

  if (error) throw new Error(`Failed to insert message: ${error.message}`);
  if (!data?.id) throw new Error("Failed to insert message: no id returned");
  LOG("insertMessage", { id: data.id, role, contentLength: content.length });
  return { id: data.id };
}

export type MessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

/**
 * Récupère les N derniers messages de la conversation (ordre created_at desc).
 * Utilisé pour construire l’historique envoyé au LLM (contexte multi-tours).
 */
export async function getLastMessages(
  conversationId: string,
  limit: number
): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[RAG/conversation] getLastMessages error", error);
    return [];
  }
  const rows = (data ?? []) as MessageRow[];
  LOG("getLastMessages", { conversationId, limit, count: rows.length });
  return rows;
}
