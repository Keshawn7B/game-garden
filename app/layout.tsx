import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const japanese = Noto_Sans_JP({ variable: "--font-japanese", subsets: ["latin"], weight: ["400", "500", "700", "900"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "pocket-play-arcade.kfuture.chatgpt.site";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const title = "Pocket Play | ポケットプレイ";
  const description = "Pocket-sized logic and memory games with local profiles, leaderboards, and high scores.";

  return {
    metadataBase: baseUrl,
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og-app-v2.png", width: 1774, height: 887, alt: "Pocket Play app and its four games" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og-app-v2.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={japanese.variable}>{children}</body></html>;
}
