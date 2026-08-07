import { createHash } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientDir = path.join(projectRoot, "dist", "client");
const workerPath = new URL("../dist/server/index.js", import.meta.url);
const outputDir = path.join(projectRoot, "firebase-public");

if (path.dirname(outputDir) !== projectRoot || path.basename(outputDir) !== "firebase-public") {
  throw new Error("Refusing to replace a Firebase output folder outside this project.");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(clientDir, outputDir, { recursive: true });

const worker = (await import(workerPath.href)).default;
const response = await worker.fetch(
  new Request("https://game-garden-658de.web.app/"),
  {},
  { waitUntil() {}, passThroughOnException() {} },
);
let html = await response.text();

if (!response.ok || !html.startsWith("<!DOCTYPE html>")) {
  throw new Error(`Could not render the Firebase entry page (${response.status}).`);
}

// Firebase Hosting uses a static CSP, so every executable bootstrap block must
// be a same-origin file. This keeps script-src free of unsafe-inline while
// preserving the order of vinext's hydration/RSC startup code.
const bootstrapDir = path.join(outputDir, "security");
const bootstrapFiles = [];
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, rawAttributes, body) => {
  const attributes = rawAttributes.replace(/\snonce=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (/\bsrc\s*=/i.test(attributes) || body.trim().length === 0) {
    return `<script${attributes}>${body}</script>`;
  }

  const declaredType = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  if (declaredType && !["text/javascript", "application/javascript", "module"].includes(declaredType)) {
    throw new Error(`Unsupported inline script type in Firebase export: ${declaredType}`);
  }

  const digest = createHash("sha256").update(body).digest("hex").slice(0, 20);
  const fileName = `bootstrap-${digest}.js`;
  bootstrapFiles.push({ fileName, body });
  return `<script${attributes} src="/security/${fileName}"></script>`;
});

if (bootstrapFiles.length === 0) {
  throw new Error("Firebase export expected at least one vinext bootstrap script.");
}

await mkdir(bootstrapDir, { recursive: true });
await Promise.all(bootstrapFiles.map(({ fileName, body }) => writeFile(path.join(bootstrapDir, fileName), body, "utf8")));

await writeFile(path.join(outputDir, "index.html"), html, "utf8");
console.log(`Firebase bundle ready (${html.length.toLocaleString()} byte entry page, ${bootstrapFiles.length} secured bootstrap files).`);
