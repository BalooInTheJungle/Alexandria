import Image from "next/image";
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
      <header className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: "#1C1404" }}>
        <div className="flex items-center gap-6">
          <Link href="/rag" className="flex items-center gap-2 shrink-0">
            <Image src="/logo.png" alt="Alexandria" width={28} height={28} className="invert" />
            <span className="font-display font-semibold text-sm tracking-wide" style={{ color: "#FECC66" }}>
              Alexandria
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" asChild className="h-auto px-3 py-1.5 text-sm font-normal text-white/80 hover:text-white hover:bg-white/10">
              <Link href="/rag">Chatbot</Link>
            </Button>
            <span className="text-white/30 text-xs">|</span>
            <Button variant="ghost" asChild className="h-auto px-3 py-1.5 text-sm font-normal text-white/80 hover:text-white hover:bg-white/10">
              <Link href="/bibliographie/documents">Database</Link>
            </Button>
            <span className="text-white/30 text-xs">|</span>
            <Button variant="ghost" asChild className="h-auto px-3 py-1.5 text-sm font-normal text-white/80 hover:text-white hover:bg-white/10">
              <Link href="/bibliographie">Bibliographie</Link>
            </Button>
            <span className="text-white/30 text-xs">|</span>
            <Button variant="ghost" asChild className="h-auto px-3 py-1.5 text-sm font-normal text-white/80 hover:text-white hover:bg-white/10">
              <Link href="/bibliographie/sources">Sources</Link>
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {user?.email && (
            <span className="text-sm text-white/50">{user.email}</span>
          )}
          <form action={signOut}>
            <Button type="submit" size="sm" className="bg-white/10 text-white hover:bg-white/20 border-0">
              Déconnexion
            </Button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
