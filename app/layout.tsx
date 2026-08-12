/* eslint-disable @next/next/no-sync-scripts -- The same-origin theme bootstrap must run before first paint to prevent a red color flash. */
import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./online-games.css";

const japanese = Noto_Sans_JP({ variable: "--font-japanese", subsets: ["latin"], weight: ["400", "500", "700", "900"] });

const defaultMetadataBase = new URL("https://gamegardenplay.web.app");
const knownPublicHosts = new Set([
  "gamegardenplay.web.app",
  "game-garden-658de.web.app",
  "pocket-play-arcade.kfuture.chatgpt.site",
]);

function safeMetadataBase(rawHost: string | null) {
  const candidate = rawHost?.split(",", 1)[0]?.trim().toLowerCase();
  if (!candidate || candidate.length > 253 || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(candidate)) return defaultMetadataBase;

  try {
    const parsed = new URL(`https://${candidate}`);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    const configuredHost = process.env.NEXT_PUBLIC_SITE_HOST?.trim().toLowerCase();
    const isConfigured = configuredHost ? parsed.hostname === configuredHost : false;
    const isKnown = knownPublicHosts.has(parsed.hostname);
    if (!isLocal && !isConfigured && !isKnown) return defaultMetadataBase;
    if (!isLocal && parsed.port && parsed.port !== "443") return defaultMetadataBase;
    return new URL(`${isLocal ? "http" : "https"}://${parsed.host}`);
  } catch {
    return defaultMetadataBase;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const baseUrl = safeMetadataBase(incoming.get("x-forwarded-host") ?? incoming.get("host"));
  const title = "Game Garden | ゲームガーデン";
  const description = "Pocket-sized logic, memory, strategy, and multiplayer games in one app.";

  return {
    metadataBase: baseUrl,
    title,
    description,
    applicationName: "Game Garden",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Game Garden" },
    formatDetection: { telephone: false },
    icons: {
      icon: [{ url: "/app-icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" }],
      apple: [{ url: "/app-icon-512.png", sizes: "512x512", type: "image/png" }],
    },
    openGraph: { title, description, type: "website", images: [{ url: "/og-game-garden.png", width: 1774, height: 887, alt: "Game Garden arcade app" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og-game-garden.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta id="game-garden-theme-color" name="theme-color" content="#e60012" />
        <script src="/theme-init.js" />
        <script src="/pwa-init.js" defer />
      </head>
      <body className={japanese.variable}>{children}</body>
    </html>
  );
}
