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
  sources?: unknown;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/**
 * Liste les conversations de l’utilisateur (ordre updated_at desc).
 */
export async function listConversations(limit = 50): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));

  if (error) {
    console.error("[RAG/conversation] listConversations error", error);
    return [];
  }
  const rows = (data ?? []) as ConversationRow[];
  LOG("listConversations", { count: rows.length });
  return rows;
}

/**
 * Récupère les messages d’une conversation avec pagination par cursor.
 * cursor = id du dernier message reçu ; retourne les limit messages suivants (ordre created_at asc).
 */
export async function getMessages(
  conversationId: string,
  opts: { cursor?: string; limit?: number } = {}
): Promise<MessageRow[]> {
  const { cursor, limit = 20 } = opts;
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(1, limit), 100);

  let query = supabase
    .from("messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(pageSize);

  if (cursor) {
    const { data: cursorRow } = await supabase
      .from("messages")
      .select("created_at")
      .eq("id", cursor)
      .eq("conversation_id", conversationId)
      .single();
    if (cursorRow?.created_at) {
      query = query.gt("created_at", cursorRow.created_at);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("[RAG/conversation] getMessages error", error);
    return [];
  }
  const rows = (data ?? []) as MessageRow[];
  LOG("getMessages", { conversationId, cursor: !!cursor, count: rows.length });
  return rows;
}

/**
 * Met à jour le titre d’une conversation.
 */
export async function updateConversationTitle(
  id: string,
  title: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const safeTitle = (title ?? "").trim().slice(0, 255) || "Nouvelle conversation";

  const { error } = await supabase
    .from("conversations")
    .update({ title: safeTitle, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    LOG("updateConversationTitle error", id, error.message);
    return { ok: false, error: error.message };
  }
  LOG("updateConversationTitle", { id, title: safeTitle });
  return { ok: true };
}

/**
 * Supprime une conversation (les messages sont supprimés en cascade).
 */
export async function deleteConversation(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { error } = await supabase.from("conversations").delete().eq("id", id);

  if (error) {
    LOG("deleteConversation error", id, error.message);
    return { ok: false, error: error.message };
  }
  LOG("deleteConversation", { id });
  return { ok: true };
}

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
