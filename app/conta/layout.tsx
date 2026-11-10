import type { Metadata } from "next";
export const metadata: Metadata = { title: "Minha conta | PokéCofre", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function MemberLayout({ children }: { children: React.ReactNode }) { return children; }
