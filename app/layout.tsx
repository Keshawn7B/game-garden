import type { Metadata } from "next";
import { Manrope, Rubik } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Rubik({ variable: "--font-display", subsets: ["latin"] });
const body = Manrope({ variable: "--font-body", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "pocket-play-arcade.kfuture.chatgpt.site";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const title = "Pocket Play — Play. Think. Win.";
  const description = "Jump into quick logic, number, and memory games from one vibrant online game hub.";

  return {
    metadataBase: baseUrl,
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Pocket Play game hub" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${display.variable} ${body.variable}`}>{children}</body></html>;
}
