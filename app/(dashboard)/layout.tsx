import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import { Button } from "@/components/ui/button";
import NavLinks from "@/components/dashboard/NavLinks";
import { LOGO_YELLOW_PATH } from "@/lib/design";

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
        <div className="flex items-center gap-4">
          <Link href="/rag" className="flex items-center shrink-0">
            <Image
              src={LOGO_YELLOW_PATH}
              alt="Alexandria"
              width={120}
              height={40}
              className="h-9 w-auto"
            />
          </Link>
          <NavLinks />
        </div>
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
