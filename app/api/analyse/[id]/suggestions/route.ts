import { NextResponse } from "next/server"

const SUGGESTIONS = [
  "Quelles sont les principales conclusions de ce document ?",
  "Quelles méthodes expérimentales ou computationnelles ont été utilisées ?",
  "En quoi ce travail se distingue-t-il des études précédentes du corpus ?",
  "Quels sont les mécanismes proposés pour expliquer les résultats observés ?",
]

export async function GET() {
  return NextResponse.json({ suggestions: SUGGESTIONS })
}
