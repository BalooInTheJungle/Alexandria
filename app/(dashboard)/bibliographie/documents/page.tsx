"use client";

import { useState, useEffect } from "react";

type DocStatus = "pending" | "processing" | "done" | "error";

interface Document {
  id: string;
  title: string | null;
  authors: string[] | null;
  doi: string | null;
  journal: string | null;
  published_at: string | null;
  storage_path: string;
  status: DocStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<DocStatus, string> = {
  done:       "Indexé",
  pending:    "En attente",
  processing: "En cours",
  error:      "Erreur",
};

const STATUS_COLORS: Record<DocStatus, string> = {
  done:       "bg-green-100 text-green-800",
  pending:    "bg-gray-100 text-gray-600",
  processing: "bg-blue-100 text-blue-700",
  error:      "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDocs() {
      console.log('[DocumentsPage] fetching documents')
      const res = await fetch("/api/documents", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Erreur ${res.status}`);
        console.error('[DocumentsPage] error:', json.error)
        setLoading(false);
        return;
      }
      console.log('[DocumentsPage] result:', { count: json.documents?.length })
      setDocuments(json.documents ?? []);
      setLoading(false);
    }
    fetchDocs();
  }, []);

  const counts = {
    total: documents.length,
    done: documents.filter(d => d.status === "done").length,
    error: documents.filter(d => d.status === "error").length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="font-display text-2xl font-semibold">Database</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl">
          Liste des PDFs indexés dans la base de connaissances. Pour ajouter des documents, placez vos fichiers dans <code className="text-xs bg-muted px-1 py-0.5 rounded">data/pdfs/</code> et relancez le script d'ingestion.
        </p>
        {!loading && (
          <p className="mt-1 text-xs text-muted-foreground">
            {counts.total} documents — {counts.done} indexés{counts.error > 0 ? `, ${counts.error} en erreur` : ""}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun document. Placez des PDFs dans <code>data/pdfs/</code> et lancez <code>python3 scripts/ingest.py</code>.
          </p>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {documents.map((doc) => (
              <div key={doc.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">
                      {doc.title ?? doc.storage_path.split("/").pop()}
                    </p>
                    {doc.authors && doc.authors.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {doc.authors.slice(0, 4).join(", ")}{doc.authors.length > 4 ? ` +${doc.authors.length - 4}` : ""}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {doc.journal && <span>{doc.journal}</span>}
                      {doc.published_at && (
                        <span>{new Date(doc.published_at).getFullYear()}</span>
                      )}
                      {doc.doi && (
                        <a
                          href={`https://doi.org/${doc.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground underline underline-offset-2"
                        >
                          {doc.doi}
                        </a>
                      )}
                    </div>
                    {doc.status === "error" && doc.error_message && (
                      <p className="text-xs text-destructive mt-1 truncate">{doc.error_message}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={doc.status} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
