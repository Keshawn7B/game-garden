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
  const description = "Play Codebreaker, Number Hunt, and Memory Flip.";

  return {
    metadataBase: baseUrl,
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og.png", width: 1774, height: 887, alt: "Pocket Play games" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={japanese.variable}>{children}</body></html>;
}
