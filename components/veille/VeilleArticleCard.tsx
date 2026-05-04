"use client";

interface VeilleArticle {
  id: string;
  title: string;
  authors: string[];
  doi: string | null;
  abstract: string | null;
  url: string;
  published_at: string | null;
  similarity_score: number | null;
  last_error: string | null;
}

interface Props {
  article: VeilleArticle;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? "bg-green-100 text-green-800" :
    pct >= 45 ? "bg-yellow-100 text-yellow-800" :
                "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

export default function VeilleArticleCard({ article }: Props) {
  const authorsStr = article.authors?.length
    ? article.authors.slice(0, 4).join(", ") + (article.authors.length > 4 ? " et al." : "")
    : null;

  const dateStr = article.published_at
    ? new Date(article.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ScoreBadge score={article.similarity_score} />
            {dateStr && (
              <span className="text-xs text-muted-foreground">{dateStr}</span>
            )}
          </div>
          <h3 className="font-medium text-sm leading-snug mb-1">
            {article.doi ? (
              <a
                href={`https://doi.org/${article.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-foreground"
              >
                {article.title}
              </a>
            ) : article.url ? (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-foreground"
              >
                {article.title}
              </a>
            ) : (
              article.title
            )}
          </h3>
          {authorsStr && (
            <p className="text-xs text-muted-foreground mb-2">{authorsStr}</p>
          )}
          {article.abstract && (
            <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
              {article.abstract}
            </p>
          )}
          {article.last_error && (
            <p className="text-xs text-destructive mt-1">Erreur : {article.last_error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
