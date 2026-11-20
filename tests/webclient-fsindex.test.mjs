import assert from "node:assert/strict";
import test from "node:test";
import { parseWebClientFsIndex } from "../scripts/webclient-fsindex.mjs";

test("parses Roblox prefix-compressed WebClient.fsindex entries", () => {
  const index = Buffer.from(
    "rbxfsindex 1\n" +
    "0\t/assets/a.bin\t10\n" +
    "8\tb.bin\t20\n" +
    "0\t/textures/avatar.png\t30\n",
    "utf8",
  );

  assert.deepEqual(parseWebClientFsIndex(index), [
    { path: "/assets/a.bin", size: 10 },
    { path: "/assets/b.bin", size: 20 },
    { path: "/textures/avatar.png", size: 30 },
  ]);
});

test("rejects an unsupported fsindex header", () => {
  assert.throws(() => parseWebClientFsIndex(Buffer.from("wrong\n")), /unsupported header/);
});

test("rejects truncated and malformed index entries", () => {
  assert.throws(() => parseWebClientFsIndex(Buffer.from("rbxfsindex 1\n0\t/path")), /truncated line/);
  assert.throws(() => parseWebClientFsIndex(Buffer.from("rbxfsindex 1\nx\t/path\t10\n")), /malformed numeric field/);
});

test("rejects prefix lengths beyond the previous path", () => {
  const index = Buffer.from("rbxfsindex 1\n0\t/a\t1\n2\tb\t1\n");
  assert.throws(() => parseWebClientFsIndex(index), /malformed entry/);
});

test("rejects unsafe index paths", () => {
  const index = Buffer.from("rbxfsindex 1\n0\t/../../etc/passwd\t12\n");
  assert.throws(() => parseWebClientFsIndex(index), /unsafe path/);
});
