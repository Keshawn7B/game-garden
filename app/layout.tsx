import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./online-games.css";

const japanese = Noto_Sans_JP({ variable: "--font-japanese", subsets: ["latin"], weight: ["400", "500", "700", "900"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "pocket-play-arcade.kfuture.chatgpt.site";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const title = "Game Garden | ゲームガーデン";
  const description = "Pocket-sized logic, memory, strategy, and multiplayer games in one app.";

  return {
    metadataBase: baseUrl,
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og-game-garden.png", width: 1774, height: 887, alt: "Game Garden arcade app" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og-game-garden.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={japanese.variable}>{children}</body></html>;
}
