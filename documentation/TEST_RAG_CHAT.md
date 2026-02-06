# Tester le RAG Chat (API + peuplement base)

**Prérequis** : documents et chunks déjà en base (ingestion faite). Migrations `conversations`, `messages`, `rag_settings` et `match_chunks` exécutées.

---

## 1. SQL — Vérifier / peupler la base

### 1.1 Paramètres RAG (`rag_settings`)

Si la migration `20260205100003_rag_settings.sql` a été exécutée, les lignes par défaut sont déjà insérées. Sinon, exécuter dans le **SQL Editor** Supabase :

```sql
-- Valeurs par défaut (idempotent)
insert into public.rag_settings (key, value) values
  ('context_turns', '3'),
  ('similarity_threshold', '0.5'),
  ('guard_message', 'Requête trop éloignée de la recherche fondamentale.'),
  ('match_count', '20'),
  ('match_threshold', '0.3')
on conflict (key) do nothing;
```

Vérifier le contenu :

```sql
select * from public.rag_settings order by key;
```

### 1.2 (Optionnel) Données de test — conversation + messages

Pour tester le **contexte multi-tours** (N derniers messages), tu peux créer une conversation avec quelques messages. Sinon, l’API crée la conversation au premier envoi.

```sql
-- Une conversation de test
insert into public.conversations (id, title, created_at, updated_at) values
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Test contexte multi-tours', now(), now())
on conflict (id) do nothing;

-- Quelques messages (remplacer l’id par celui de ta conversation si besoin)
insert into public.messages (conversation_id, role, content, created_at) values
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'user', 'Quelle est la méthode utilisée dans cet article ?', now() - interval '2 minutes'),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'assistant', 'D''après le document [1], la méthode utilisée est la diffraction X.', now() - interval '1 minute');
```

Pour l’API, tu n’as pas besoin de ces lignes : une **nouvelle conversation** est créée automatiquement si tu n’envoies pas de `conversationId`.

### 1.3 Vérifier documents et chunks

```sql
-- Nombre de documents en done
select count(*) from public.documents where status = 'done';

-- Nombre de chunks avec embedding
select count(*) from public.chunks where embedding is not null;

-- Un aperçu des titres
select id, title, storage_path from public.documents where status = 'done' limit 5;
```

---

## 2. Lancer l’app (front Next.js)

Tu as bien un **front Next.js** (dashboard avec RAG | Bibliographie). La page RAG existe mais l’interface chat (champ de saisie, affichage réponse/sources en streaming) n’est pas encore implémentée — pour l’instant tu testes l’API à la main.

**Lancer l’app :**

```bash
cd /chemin/vers/Alexandria
npm install   # si pas déjà fait
npm run dev
```

Ouvre **http://localhost:3000**. Tu arrives sur la page d’accueil ; si tu es redirigé vers **/login**, connecte-toi avec **email + mot de passe** (les cookies de session sont gérés automatiquement par Supabase côté front). Ensuite va sur **RAG** (lien dans la nav) : tu as un champ de texte pour poser une question ; la réponse s’affiche sous le champ et dans la **console du navigateur** (`[RAG] Response:`). Les logs serveur (embedding, recherche, OpenAI, persistance) s’affichent dans le **terminal** où tourne `npm run dev`.

**Créer un utilisateur pour se connecter** : Supabase Dashboard → **Authentication** → **Users** → **Add user** → crée un user avec email et mot de passe, puis utilise ces identifiants sur la page /login.

---

## 3. Tester l’API depuis l’app (recommandé)

L’API utilise la **session Supabase** (cookies). Il faut être **connecté** et sur la même origine (localhost:3000).

### 3.1 Réponse JSON (sans stream)

Sur **http://localhost:3000/rag** (une fois connecté), ouvre les **DevTools** (F12) → onglet **Console**, puis exécute :

```javascript
const res = await fetch('/api/rag/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'Résume les méthodes utilisées dans le corpus.',
    stream: false
  })
});
const data = await res.json();
console.log(data);
// { answer: "...", sources: [...], conversationId: "...", messageId: "..." }
```

Avec une conversation existante (enchaîner les questions) :

```javascript
const res = await fetch('/api/rag/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'Et quels sont les résultats principaux ?',
    conversationId: 'COLLER_ICI_CONVERSATION_ID',
    stream: false
  })
});
const data = await res.json();
console.log(data);
```

### 3.2 Réponse en streaming (SSE)

```javascript
const res = await fetch('/api/rag/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'Résume les méthodes utilisées dans le corpus.',
    stream: true
  })
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let text = '';
let donePayload = null;

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.text) {
        text += data.text;
        console.log(data.text); // ou afficher dans l’UI
      }
      if (data.done) {
        donePayload = data;
        console.log('Fin:', data.conversationId, data.messageId, data.sources);
      }
      if (data.error) console.error(data.error);
    }
  }
}
console.log('Réponse complète:', text);
```

---

## 4. Tester avec cURL

L’API exige une **session authentifiée** (cookies Supabase). Deux options :

### 4.1 Récupérer le cookie de session

1. Connecte-toi sur ton app (ex. `http://localhost:3000/rag`).
2. Ouvre les **DevTools** → **Application** (Chrome) ou **Stockage** (Firefox) → **Cookies** → ton domaine.
3. Repère le cookie dont le nom contient `supabase` ou `sb-` (ex. `sb-xxx-auth-token`). Copie la **valeur** (ou tout le header `Cookie`).

### 4.2 Requête cURL (remplacer `TON_COOKIE` et l’URL)

**Réponse JSON :**

```bash
curl -X POST 'http://localhost:3000/api/rag/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: TON_COOKIE_ICI' \
  -d '{"query":"Résume les méthodes utilisées.","stream":false}'
```

**Exemple de réponse :**

```json
{
  "answer": "D'après le corpus [1]...",
  "sources": [
    { "index": 1, "title": "...", "doi": "...", "storage_path": "data/pdfs/...", "excerpt": "..." }
  ],
  "conversationId": "uuid",
  "messageId": "uuid"
}
```

**Avec conversation existante :**

```bash
curl -X POST 'http://localhost:3000/api/rag/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: TON_COOKIE_ICI' \
  -d '{"query":"Quels sont les résultats ?","conversationId":"COLLER_CONVERSATION_ID","stream":false}'
```

**Streaming (événements SSE) :**

```bash
curl -X POST 'http://localhost:3000/api/rag/chat' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: TON_COOKIE_ICI' \
  -d '{"query":"Résume les méthodes.","stream":true}' \
  --no-buffer
```

Tu verras défiler des lignes `data: {"text":"..."}` puis `data: {"done":true,...}`.

---

## 5. Cas à tester

| Cas | Body | Attendu |
|-----|------|--------|
| Première question | `{ "query": "Résume les méthodes." }` | Nouvelle conversation créée, `conversationId` + `messageId` dans la réponse. |
| Suite dans la même conversation | `{ "query": "...", "conversationId": "<id>" }` | Même `conversationId`, réponse qui peut s’appuyer sur les N derniers messages. |
| Hors domaine | `{ "query": "Quelle musique à Woodstock ?" }` | Réponse = message garde-fou (pas d’appel LLM), `sources: []`. |
| Stream | `{ "query": "...", "stream": true }` | Réponse en SSE : `data: {"text":"..."}` puis `data: {"done":true,...}`. |

---

## 6. Lister les conversations (SQL)

Pour récupérer un `conversationId` à coller dans les tests :

```sql
select id, title, created_at, updated_at
from public.conversations
order by updated_at desc
limit 10;
```

Pour voir les messages d’une conversation :

```sql
select id, role, left(content, 80) as content_preview, created_at
from public.messages
where conversation_id = 'COLLER_CONVERSATION_ID'
order by created_at asc;
```
