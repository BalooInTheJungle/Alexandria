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
  id: string
  name: string
  publisher: string | null
  issn: string | null
  url: string
  rss_url: string | null
  source_type: 'rss' | 'openalex'
  active: boolean
  created_at: string
  last_checked_at: string | null
}

export type SourceInsert = Omit<Source, 'id' | 'created_at' | 'last_checked_at'>

export type RunLogLevel = 'info' | 'error' | 'warn'

export type RunLogEntry = {
  ts:    string        // ISO timestamp
  level: RunLogLevel
  phase: string        // e.g. 'sources', 'scoring', 'summary'
  msg:   string
}

export type VeilleRun = {
  id: string;
  status: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  ai_summary?: string | null;
  high_score_count?: number | null;
  score_threshold?: number | null;
  pipeline_logs?: RunLogEntry[];
};

export type CorpusRef = {
  doc_title: string;
  excerpt: string;
  page: number | null;
  similarity: number;
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
  corpus_refs?: CorpusRef[] | null;
};
