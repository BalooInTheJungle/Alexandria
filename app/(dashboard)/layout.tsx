import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import { Button } from "@/components/ui/button";

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
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <nav className="flex items-center gap-2">
          <Button variant="link" asChild className="h-auto p-0 font-normal">
            <Link href="/rag">Chatbot</Link>
          </Button>
          <span className="text-muted-foreground">|</span>
          <Button variant="link" asChild className="h-auto p-0 font-normal">
            <Link href="/database">Database</Link>
          </Button>
          <span className="text-muted-foreground">|</span>
          <Button variant="link" asChild className="h-auto p-0 font-normal">
            <Link href="/bibliographie">Bibliographie</Link>
          </Button>
        </nav>
        <div className="flex items-center gap-4">
          {user?.email && (
            <span className="text-sm text-muted-foreground">{user.email}</span>
          )}
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Déconnexion
            </Button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
