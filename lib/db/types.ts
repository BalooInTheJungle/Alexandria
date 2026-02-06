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

export type Source = {
  id: string;
  url: string;
  name?: string;
  created_at?: string;
};

export type VeilleRun = {
  id: string;
  status: string;
  created_at?: string;
};

export type VeilleItem = {
  id: string;
  run_id: string;
  source_id: string;
  url: string;
  title?: string;
  authors?: string[];
  doi?: string;
  abstract?: string;
  date?: string;
  similarity_score?: number;
  last_error?: string;
  created_at?: string;
};
