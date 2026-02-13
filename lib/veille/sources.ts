/**
 * Liste des sources depuis la DB. Utilisé par la pipeline (avec client admin).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const LOG = (msg: string, ...args: unknown[]) => console.log("[veille/sources]", msg, ...args);

export type SourceRow = {
  id: string;
  url: string;
  name: string | null;
  fetch_strategy?: "auto" | "fetch" | "rss" | null;
};

export async function listSourcesFromDb(
  supabase: SupabaseClient
): Promise<SourceRow[]> {
  LOG("listSourcesFromDb");
  const { data, error } = await supabase
    .from("sources")
    .select("id, url, name, fetch_strategy")
    .order("created_at", { ascending: false });

  if (error) {
    LOG("listSourcesFromDb error", error.message);
    throw error;
  }
  LOG("listSourcesFromDb ok", { count: (data ?? []).length });
  return (data ?? []) as SourceRow[];
}
