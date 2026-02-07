"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConversationItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  refreshTrigger?: number;
};

export default function RagConversationSidebar({
  selectedId,
  onSelect,
  refreshTrigger = 0,
}: Props) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [deleteModal, setDeleteModal] = useState<{ id: string; title: string } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rag/conversations?limit=50", { credentials: "include" });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setConversations(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, refreshTrigger]);

  function handleNew() {
    onSelect(null);
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renameId || !renameValue.trim()) {
      setRenameId(null);
      return;
    }
    const res = await fetch(`/api/rag/conversations/${renameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: renameValue.trim().slice(0, 255) }),
    });
    if (res.ok) {
      setRenameId(null);
      fetchConversations();
    }
  }

  async function handleDelete() {
    if (!deleteModal) return;
    const res = await fetch(`/api/rag/conversations/${deleteModal.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      if (selectedId === deleteModal.id) onSelect(null);
      setDeleteModal(null);
      fetchConversations();
    }
  }

  const formatDate = (s: string) => {
    const d = new Date(s);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (diff < 604800000) return d.toLocaleDateString("fr-FR", { weekday: "short" });
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border p-3">
        <Button onClick={handleNew} className="w-full" variant="outline" size="sm">
          + Nouvelle conversation
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {loading && conversations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "cursor-pointer rounded-md border-l-2 px-3 py-2 transition-colors",
                  selectedId === c.id
                    ? "border-l-primary bg-primary/10"
                    : "border-l-transparent hover:bg-muted/50"
                )}
                onClick={() => onSelect(c.id)}
              >
                {renameId === c.id ? (
                  <form onSubmit={handleRenameSubmit} onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <div className="mt-2 flex gap-1">
                      <Button type="submit" size="sm" className="text-xs">
                        OK
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRenameId(null)} className="text-xs">
                        Annuler
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="truncate text-sm font-medium">
                      {c.title || "Sans titre"}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(c.updated_at)}</div>
                    <div className="mt-2 flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameId(c.id);
                          setRenameValue(c.title || "");
                        }}
                      >
                        Renommer
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteModal({ id: c.id, title: c.title || "Sans titre" });
                        }}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!deleteModal} onOpenChange={(open) => !open && setDeleteModal(null)}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Supprimer cette conversation ?</DialogTitle>
            <DialogDescription>
              &laquo; {deleteModal?.title} &raquo; — Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteModal(null)}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
