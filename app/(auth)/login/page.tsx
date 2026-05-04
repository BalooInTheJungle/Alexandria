"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }
      router.refresh();
      router.push("/rag");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#1C1404" }}
    >
      {/* Logo + name */}
      <div className="flex flex-col items-center gap-4 mb-10">
        <Image src="/logo.png" alt="Alexandria" width={64} height={64} className="invert" />
        <h1 className="font-display text-3xl font-bold tracking-wide" style={{ color: "#FECC66" }}>
          Alexandria
        </h1>
        <p className="text-sm text-white/50 text-center max-w-xs">
          Veille scientifique & base de connaissances — Molecular Materials & Magnetism
        </p>
      </div>

      {/* Card formulaire */}
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-white/70 text-sm">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="vous@labo.fr"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-[#FECC66]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-white/70 text-sm">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-[#FECC66]"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full font-semibold mt-1"
            style={{ backgroundColor: "#FECC66", color: "#1C1404" }}
          >
            {loading ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      </div>
    </main>
  );
}
