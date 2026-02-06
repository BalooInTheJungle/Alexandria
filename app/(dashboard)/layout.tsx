import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 1rem", borderBottom: "1px solid #eee" }}>
        <nav>
          <Link href="/rag">RAG</Link>
          <span> | </span>
          <Link href="/bibliographie">Bibliographie</Link>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {user?.email && (
            <span style={{ fontSize: "0.9rem", color: "#666" }}>{user.email}</span>
          )}
          <form action={signOut}>
            <button type="submit">Déconnexion</button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
