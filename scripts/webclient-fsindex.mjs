/**
 * Parse Roblox's prefix-compressed WebClient.fsindex.txt format.
 *
 * Each line contains: prefix byte count, a path suffix, and file size,
 * separated by TAB characters. The next path reuses the indicated byte prefix
 * from the previous path.
 */
export function parseWebClientFsIndex(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const header = Buffer.from("rbxfsindex 1\n", "utf8");
  if (buffer.length < header.length || !buffer.subarray(0, header.length).equals(header)) {
    throw new Error("WebClient.fsindex.txt: unsupported header");
  }

  const entries = [];
  let previousPath = Buffer.alloc(0);
  let position = header.length;

  while (position < buffer.length) {
    const firstTab = buffer.indexOf(9, position);
    const secondTab = firstTab >= 0 ? buffer.indexOf(9, firstTab + 1) : -1;
    const newline = secondTab >= 0 ? buffer.indexOf(10, secondTab + 1) : -1;
    if (firstTab < 0 || secondTab < 0 || newline < 0) {
      throw new Error("WebClient.fsindex.txt: truncated line");
    }

    const prefixText = buffer.subarray(position, firstTab).toString("ascii");
    const suffix = buffer.subarray(firstTab + 1, secondTab);
    const sizeText = buffer.subarray(secondTab + 1, newline).toString("ascii");
    if (!/^[0-9]+$/.test(prefixText) || !/^[0-9]+$/.test(sizeText)) {
      throw new Error("WebClient.fsindex.txt: malformed numeric field");
    }

    const prefixLength = Number(prefixText);
    const size = Number(sizeText);
    if (!Number.isSafeInteger(prefixLength) || prefixLength > previousPath.length ||
        !Number.isSafeInteger(size) || size < 0 || suffix.includes(13)) {
      throw new Error("WebClient.fsindex.txt: malformed entry");
    }

    const fullPath = Buffer.concat([previousPath.subarray(0, prefixLength), suffix]);
    const path = fullPath.toString("utf8");
    if (!path.startsWith("/") || path.includes(String.fromCharCode(0)) ||
        path.includes(String.fromCharCode(92)) || path.split("/").includes("..")) {
      throw new Error("WebClient.fsindex.txt: unsafe path");
    }

    entries.push({ path, size });
    previousPath = fullPath;
    position = newline + 1;
  }

  return entries;
}
