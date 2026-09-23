import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PokéCofre | Envio e Cofre de Cartas",
  description: "Guarde suas cartas Pokémon no cofre ou solicite envio por PAC e SEDEX. Sua coleção em boas mãos.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
