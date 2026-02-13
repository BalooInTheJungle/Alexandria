// Types partagés pour documents, chunks, sources, veille
// TODO: aligner avec le schéma Supabase

export type Document = {
  id: string;
  title?: string;
  authors?: string[];
  doi?: string;
  journal?: string;
  date?: string;
  storage_path: string;
  user_id?: string;
  created_at?: string;
};

export type Chunk = {
  id: string;
  document_id: string;
  content: string;
  position: number;
  page?: number;
  embedding?: number[];
  created_at?: string;
};

/** Stratégie de récupération du contenu source : auto (fetch), fetch, rss. */
export type SourceFetchStrategy = "auto" | "fetch" | "rss";

export type Source = {
  id: string;
  url: string;
  name?: string | null;
  fetch_strategy?: SourceFetchStrategy | null;
  created_at?: string;
  last_checked_at?: string | null;
};

export type VeilleRun = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  created_at?: string;
};

export type VeilleItem = {
  id: string;
  run_id: string;
  source_id: string;
  url: string;
  title?: string | null;
  authors?: string[] | null;
  doi?: string | null;
  abstract?: string | null;
  published_at?: string | null;
  heuristic_score?: number | null;
  similarity_score?: number | null;
  last_error?: string | null;
  created_at?: string;
};
