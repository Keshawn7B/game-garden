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
const html = await response.text();

if (!response.ok || !html.startsWith("<!DOCTYPE html>")) {
  throw new Error(`Could not render the Firebase entry page (${response.status}).`);
}

await writeFile(path.join(outputDir, "index.html"), html, "utf8");
console.log(`Firebase bundle ready (${html.length.toLocaleString()} byte entry page).`);
