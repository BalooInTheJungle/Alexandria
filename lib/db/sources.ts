/**
 * CRUD sources de veille (table sources).
 */

import { createClient } from "@/lib/supabase/server";
import type { Source, SourceFetchStrategy } from "@/lib/db/types";

const LOG = (msg: string, ...args: unknown[]) => console.log("[db/sources]", msg, ...args);

export type SourceInsert = Pick<Source, "url"> & { name?: string | null; fetch_strategy?: SourceFetchStrategy | null };
export type SourceUpdate = Partial<Pick<Source, "url" | "name" | "fetch_strategy">>;

export async function listSources(): Promise<Source[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("id, url, name, fetch_strategy, created_at, last_checked_at")
    .order("created_at", { ascending: false });

  if (error) {
    LOG("listSources error", error.message);
    throw error;
  }
  LOG("listSources", { count: (data ?? []).length });
  return (data ?? []) as Source[];
}

export async function createSource(row: SourceInsert): Promise<Source> {
  const supabase = await createClient();
  LOG("createSource", { url: row.url?.slice(0, 50), name: row.name ?? null });
  const { data, error } = await supabase
    .from("sources")
    .insert({
      url: row.url,
      name: row.name ?? null,
      ...(row.fetch_strategy != null && { fetch_strategy: row.fetch_strategy }),
    })
    .select("id, url, name, fetch_strategy, created_at, last_checked_at")
    .single();

  if (error) {
    LOG("createSource error", error.message);
    throw error;
  }
  LOG("createSource ok", { id: data.id });
  return data as Source;
}

export async function updateSource(id: string, updates: SourceUpdate): Promise<Source> {
  const supabase = await createClient();
  LOG("updateSource", { id, keys: Object.keys(updates) });
  const { data, error } = await supabase
    .from("sources")
    .update(updates)
    .eq("id", id)
    .select("id, url, name, fetch_strategy, created_at, last_checked_at")
    .single();

  if (error) {
    LOG("updateSource error", error.message);
    throw error;
  }
  return data as Source;
}

export async function deleteSource(id: string): Promise<void> {
  const supabase = await createClient();
  LOG("deleteSource", { id });
  const { error } = await supabase.from("sources").delete().eq("id", id);
  if (error) {
    LOG("deleteSource error", error.message);
    throw error;
  }
  LOG("deleteSource ok");
}

export async function getSourceById(id: string): Promise<Source | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sources")
    .select("id, url, name, fetch_strategy, created_at, last_checked_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    LOG("getSourceById error", id, error.message);
    throw error;
  }
  return data as Source | null;
}
