"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/rag", label: "Chatbot" },
  { href: "/database", label: "Database" },
  { href: "/bibliographie", label: "Bibliographie" },
] as const;

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2">
      {links.map(({ href, label }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <span key={href} className="contents">
            <Button
              variant="link"
              asChild
              className={cn(
                "h-auto p-0 font-title font-bold",
                isActive ? "text-primary" : "text-brand-dark"
              )}
            >
              <Link href={href}>{label}</Link>
            </Button>
            {href !== links[links.length - 1].href && (
              <span className="text-muted-foreground">|</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
