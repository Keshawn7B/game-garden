/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const FIREBASE_CONNECT_SOURCES = [
  "https://*.googleapis.com",
  "https://*.firebaseio.com",
  "wss://*.firebaseio.com",
  "https://*.firebaseapp.com",
  "https://accounts.google.com",
  "https://www.google.com/recaptcha/",
  "https://www.gstatic.com/recaptcha/",
].join(" ");

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' ${FIREBASE_CONNECT_SOURCES}`,
    "frame-src 'self' https://game-garden-658de.firebaseapp.com https://accounts.google.com https://www.google.com/recaptcha/",
    "form-action 'self' https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function responseNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hardenResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Permissions-Policy", "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  if (!headers.get("content-type")?.toLowerCase().includes("text/html")) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const nonce = responseNonce();
  const html = (await response.text()).replace(/<script(?![^>]*\bnonce=)(?=[\s>])/gi, `<script nonce="${nonce}"`);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  headers.delete("Content-Length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    return hardenResponse(response);
  },
};

export default worker;
