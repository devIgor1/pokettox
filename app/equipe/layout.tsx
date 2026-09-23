import type { Metadata } from "next";
export const metadata: Metadata = { title: "Área da equipe | PokéCofre", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function TeamLayout({ children }: { children: React.ReactNode }) { return children; }
