// Pull Roblox's official browser client (binary type "WebClientApp") from
// setup.rbxcdn.com into public/roblox-player/engine/, plus a pinned copy of its live
// FFlags. The engine is an Emscripten build: WasmPlayer.js boots WebClient.js +
// WebClient.wasm and prefetches every file listed in WebClient.fsindex.txt
// (new builds) or WebClient.metadata.json (legacy builds) from the same base URL.
//
// Run: npm run roblox:engine:update [version-xxxxxxxxxxxxxxxx]
// Without an argument the current production version is resolved from
// clientsettings.roblox.com. Files already on disk with the expected size are
// skipped, so an interrupted run resumes. WebClient.wasm (about 100 MB) also
// gets a gzip copy beside it, which the server sends to browsers that accept it.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { parseWebClientFsIndex } from "./webclient-fsindex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYER_ROOT = join(ROOT, "public", "roblox-player");
const OUT = join(PLAYER_ROOT, "engine");
const VERSION_FILE = join(OUT, "version.json");
const EPOXY_FILE = join(PLAYER_ROOT, "epoxy.mjs");
const EPOXY_URL = "https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@3.0.1/dist/index.mjs";

const BINARY_TYPE = "WebClientApp";
const CLIENT_VERSION_URL = `https://clientsettings.roblox.com/v2/client-version/${BINARY_TYPE}`;
const FLAGS_URL = `https://clientsettingscdn.roblox.com/v2/settings/application/${BINARY_TYPE}`;
const CDN = "https://setup.rbxcdn.com/webclient";
// Core files are loaded directly by the player. The content index is fetched separately.
const CORE = ["WasmPlayer.js", "WebClient.js", "WebClient.wasm"];
const CONCURRENCY = 16;
const RETRIES = 3;
const VERSION_RE = /^version-[0-9a-f]{16}$/;
const GZIP = ["WebClient.wasm"];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function sizeOnDisk(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

// Downloads url to path, writing through a .part file so a crash never leaves a
// truncated file that a later run would mistake for complete. Anything already
// on disk was therefore fully written for the version recorded in version.json.
async function download(url, path, expectedSize) {
  const existing = await sizeOnDisk(path);
  if (existing >= 0 && (expectedSize === undefined || existing === expectedSize)) return false;
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const declared = res.headers.get("content-encoding") ? NaN : Number(res.headers.get("content-length"));
      const want = expectedSize ?? (Number.isFinite(declared) ? declared : undefined);
      if (want !== undefined && body.length !== want) throw new Error(`size ${body.length}, expected ${want}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.part`, body);
      await rename(`${path}.part`, path);
      return true;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

async function pool(items, worker) {
  let next = 0;
  let done = 0;
  const failures = [];
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        failures.push(err.message);
      }
      if (++done % 250 === 0 || done === items.length) console.log(`[webblox] ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const ifMissing = args.includes("--if-missing");
  const pinned = args.find(arg => VERSION_RE.test(arg));
  const unknown = args.filter(arg => !["--force", "--if-missing"].includes(arg) && !VERSION_RE.test(arg));
  if (unknown.length) throw new Error(`unexpected argument: ${unknown[0]}`);
  await mkdir(PLAYER_ROOT, { recursive: true });
  if (force || (await sizeOnDisk(EPOXY_FILE)) < 0) {
    console.log("[webblox] fetching pinned Epoxy browser transport");
    await download(EPOXY_URL, EPOXY_FILE);
  } else console.log("[webblox] keeping existing Epoxy browser transport");
  if (ifMissing && !force) {
    try {
      const existing = JSON.parse(await readFile(VERSION_FILE, "utf8"));
      const required = ["WasmPlayer.js", "WebClient.js", "WebClient.wasm", "PinnedFlags.json"];
      const sizes = await Promise.all(required.map(name => sizeOnDisk(join(OUT, name))));
      const hasIndex = (await sizeOnDisk(join(OUT, "WebClient.fsindex.txt"))) > 0 || (await sizeOnDisk(join(OUT, "WebClient.metadata.json"))) > 0;
      if (existing.complete === true && sizes.every(size => size > 0) && hasIndex) {
        console.log(`[webblox] keeping installed engine ${existing.clientVersionUpload}`);
        return;
      }
    } catch {}
  }
  const live = pinned ? null : await getJson(CLIENT_VERSION_URL);
  const upload = pinned ?? live.clientVersionUpload;
  if (!VERSION_RE.test(upload ?? "")) throw new Error(`unexpected client-version response: ${JSON.stringify(live)}`);
  const base = `${CDN}/${upload}-RobloxWebClient`;
  console.log(`[webblox] engine ${upload}${live ? ` (${live.version})` : " (pinned)"}`);
  console.log(`[webblox] from ${base}`);

  // A different version shares almost nothing byte-for-byte; start clean rather
  // than leave stale assets next to the new engine. The marker is written before
  // any download so an interrupted run can only ever resume the same version.
  let previous = null;
  try {
    previous = JSON.parse(await readFile(VERSION_FILE, "utf8")).clientVersionUpload;
  } catch {}
  if (previous !== upload) {
    if (previous) console.log(`[webblox] replacing ${previous}`);
    await rm(OUT, { recursive: true, force: true });
  }
  await mkdir(OUT, { recursive: true });
  const record = { clientVersionUpload: upload, version: live?.version ?? null, source: base, complete: false };
  await writeFile(VERSION_FILE, `${JSON.stringify(record, null, 2)}\n`);

  for (const name of CORE) {
    const fetched = await download(`${base}/${name}`, join(OUT, name));
    console.log(`[webblox] ${fetched ? "fetched" : "kept"} ${name}`);
  }
  try {
    const fetched = await download(base + "/audio-processor-fast.js", join(OUT, "audio-processor-fast.js"));
    console.log("[webblox] " + (fetched ? "fetched" : "kept") + " audio-processor-fast.js");
  } catch (error) {
    console.warn("[webblox] optional audio processor unavailable: " + error.message);
  }
  for (const name of GZIP) {
    const path = join(OUT, name);
    if ((await sizeOnDisk(`${path}.gz`)) >= 0) continue;
    await pipeline(createReadStream(path), createGzip({ level: 9 }), createWriteStream(`${path}.gz.part`));
    await rename(`${path}.gz.part`, `${path}.gz`);
    console.log(`[webblox] gzipped ${name} (${((await sizeOnDisk(`${path}.gz`)) / 1e6).toFixed(1)} MB)`);
  }

  let entries;
  try {
    const indexPath = join(OUT, "WebClient.fsindex.txt");
    const fetched = await download(base + "/WebClient.fsindex.txt", indexPath);
    entries = parseWebClientFsIndex(await readFile(indexPath));
    console.log("[webblox] " + entries.length + " files listed via WebClient.fsindex.txt (" + (fetched ? "fetched" : "kept") + ")");
  } catch (fsIndexError) {
    console.warn("[webblox] WebClient.fsindex.txt unavailable (" + fsIndexError.message + "); trying legacy WebClient.metadata.json");
    const metadataPath = join(OUT, "WebClient.metadata.json");
    await download(base + "/WebClient.metadata.json", metadataPath);
    entries = JSON.parse(await readFile(metadataPath, "utf8"));
    if (!Array.isArray(entries)) throw new Error("WebClient.metadata.json is not a file list");
  }

  const seenPaths = new Set();
  const files = entries.filter(entry => {
    const size = Number(entry?.size);
    const path = entry?.path;
    const validPath = typeof path === "string" && path.startsWith("/") &&
      !path.includes(String.fromCharCode(92)) && !path.includes(String.fromCharCode(0)) &&
      !path.split("/").includes("..");
    const validSize = Number.isSafeInteger(size) && size >= 0;
    const unique = typeof path === "string" && !seenPaths.has(path);
    if (validPath && validSize && unique) seenPaths.add(path);
    else console.warn("[webblox] skipping bad or duplicate index entry " + JSON.stringify(entry));
    return validPath && validSize && unique;
  }).map(entry => ({ ...entry, size: Number(entry.size) }));
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  console.log(`[webblox] ${files.length} content files, ${(total / 1e6).toFixed(1)} MB`);
  const failures = await pool(files, entry =>
    download(`${base}${encodeURI(entry.path)}`, join(OUT, entry.path), entry.size));
  if (failures.length) {
    for (const message of failures) console.error(`[webblox] failed ${message}`);
    process.exit(1);
  }

  // Same shape the player page reads: flags pinned to the engine they came from,
  // so a later Roblox flag push cannot break this build.
  const flags = await getJson(FLAGS_URL);
  const pinnedAt = new Date().toISOString();
  await writeFile(join(OUT, "PinnedFlags.json"),
    JSON.stringify({ engine: upload, pinnedAt, applicationSettings: flags.applicationSettings }));
  console.log(`[webblox] pinned ${Object.keys(flags.applicationSettings).length} flags`);

  await writeFile(VERSION_FILE, `${JSON.stringify({ ...record, complete: true, fetchedAt: pinnedAt }, null, 2)}\n`);
  console.log(`[webblox] done: ${OUT}`);
}

main().catch(err => {
  console.error(`[webblox] ${err.message}`);
  process.exit(1);
});
