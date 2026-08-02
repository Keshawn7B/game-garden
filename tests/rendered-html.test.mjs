import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Pocket Play game hub", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pocket Play/);
  assert.match(html, /Games/);
  assert.match(html, /ポケットプレイ/);
  assert.match(html, /ゲーム/);
  assert.doesNotMatch(html, /POCKET ARCADE|SMALL GAMES|HOW TO PLAY|ポケットアーケード/);
  assert.match(html, /Codebreaker/);
  assert.match(html, /Order Match/);
  assert.match(html, /Number Hunt/);
  assert.match(html, /Memory Flip/);
  assert.match(html, /Meducktion/);
  assert.match(html, /Deducktion/);
  assert.match(html, /App navigation/);
  assert.match(html, /Ranks/);
  assert.match(html, /Profile/);
  assert.match(html, /og-app-v2\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("routes every game through a start menu", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /codebreaker-menu/);
  assert.match(source, /order-menu/);
  assert.match(source, /number-menu/);
  assert.match(source, /memory-menu/);
  assert.match(source, /meducktion-menu/);
  assert.match(source, /deducktion-menu/);
  assert.match(source, /function GameMenu/);
  assert.match(source, /Start Game/);
  assert.match(source, /How to play/);
  assert.match(source, /aria-label="Close game menu"/);
  assert.match(source, /className="menu-close"/);
  assert.match(source, /<div className="menu-card">\s*<button className="menu-close"/);
  assert.match(source, /function OrderMatch/);
  assert.match(source, /switchObject/);
  assert.match(source, /Check order/);
  assert.match(source, /pocket-play-scores/);
  assert.match(source, /function AppHome/);
  assert.match(source, /function PlayerAvatar/);
  assert.match(source, /activeTab === "leaderboard"/);
  assert.match(source, /activeTab === "profile"/);
  assert.match(source, /function EmbeddedGame/);
  assert.match(source, /keshawn7b\.github\.io\/Meducktion/);
  assert.match(source, /keshawn7b\.github\.io\/deduction-game/);
  assert.match(source, /deducktion-cover-title">DEDUCKTION/);
  assert.match(styles, /game-covers\.png/);
  assert.match(styles, /\.bottom-nav/);
});
