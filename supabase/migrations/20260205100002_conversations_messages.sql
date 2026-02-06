-- Alexandria: conversations et messages (chatbot RAG avec historique)
-- Un seul utilisateur pour l’instant ; user_id optionnel pour évolution.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Nouvelle conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_updated_at on public.conversations (updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_id on public.messages (conversation_id);
create index if not exists idx_messages_created_at on public.messages (conversation_id, created_at desc);

comment on table public.conversations is 'Fil de conversation du chatbot RAG ; titre modifiable ; rétention 30 jours.';
comment on table public.messages is 'Messages user/assistant par conversation ; sources (citations) en jsonb pour les réponses.';

-- RLS
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "conversations_select" on public.conversations for select to authenticated using (true);
create policy "conversations_insert" on public.conversations for insert to authenticated with check (true);
create policy "conversations_update" on public.conversations for update to authenticated using (true);
create policy "conversations_delete" on public.conversations for delete to authenticated using (true);

create policy "messages_select" on public.messages for select to authenticated using (true);
create policy "messages_insert" on public.messages for insert to authenticated with check (true);
create policy "messages_update" on public.messages for update to authenticated using (true);
create policy "messages_delete" on public.messages for delete to authenticated using (true);
