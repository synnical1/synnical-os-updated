import { createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "public/brand/wallpapers/sakura-samurai-4k.mp4")
const source = path.join(root, ".cache/sakura-samurai-source.mp4")
const temporaryOutput = output + ".tmp"
const sourceUrl = "https://livewallpapers4free.com/download/21316/"
const referer = "https://livewallpapers4free.com/old-japanese-samurai-sakura-leaf-fall/"

function inspect(file) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate",
    "-of", "json",
    file,
  ], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`ffprobe could not inspect ${path.basename(file)}: ${result.stderr || "unknown error"}`)
  const stream = JSON.parse(result.stdout).streams?.[0]
  if (!stream) throw new Error("Wallpaper has no video stream")
  const [numerator, denominator] = String(stream.r_frame_rate || "0/1").split("/").map(Number)
  return { codec: stream.codec_name, width: stream.width, height: stream.height, fps: denominator ? numerator / denominator : 0 }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

async function prepare() {
  await mkdir(path.dirname(output), { recursive: true })
  await mkdir(path.dirname(source), { recursive: true })

  try {
  const existing = await stat(output).catch(() => null)
  if (existing?.size > 2_000_000) {
    const info = inspect(output)
    if (info.codec === "h264" && info.width === 3840 && info.height === 2160 && info.fps <= 30.1) {
      process.stdout.write(`Using cached 4K/30fps wallpaper (${existing.size.toLocaleString()} bytes).\n`)
      return
    }
  }

  process.stdout.write("Fetching the source 4K Sakura Samurai MP4…\n")
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: { referer, "user-agent": "SynnicalOS-WallpaperBuilder/1.0" },
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok || !response.body) throw new Error(`Wallpaper source returned HTTP ${response.status}`)
  const contentType = response.headers.get("content-type") || ""
  if (!/video\/(?:mp4|x-m4v)|application\/octet-stream/i.test(contentType)) {
    throw new Error(`Wallpaper source did not return an MP4 (content-type: ${contentType || "missing"})`)
  }

  await rm(source, { force: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(source))
  const downloaded = await stat(source)
  if (downloaded.size < 10_000_000) throw new Error(`Wallpaper download is unexpectedly small (${downloaded.size} bytes)`)
  const inputInfo = inspect(source)
  if (inputInfo.width !== 3840 || inputInfo.height !== 2160) {
    throw new Error(`Wallpaper source is ${inputInfo.width}x${inputInfo.height}, expected native 3840x2160`)
  }
  process.stdout.write(`Downloaded native 4K source (${downloaded.size.toLocaleString()} bytes, ${inputInfo.fps} fps).\n`)

  await rm(temporaryOutput, { force: true })
  run("ffmpeg", [
    "-y", "-i", source,
    "-an",
    "-vf", "fps=30",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "29",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-profile:v", "high",
    "-level:v", "5.1",
    temporaryOutput,
  ])

  const outputInfo = inspect(temporaryOutput)
  if (outputInfo.codec !== "h264" || outputInfo.width !== 3840 || outputInfo.height !== 2160 || Math.abs(outputInfo.fps - 30) > 0.1) {
    throw new Error(`Prepared wallpaper failed validation: ${JSON.stringify(outputInfo)}`)
  }
  const prepared = await stat(temporaryOutput)
  if (prepared.size > 90_000_000) throw new Error(`Prepared wallpaper exceeds the 90 MB deployment limit (${prepared.size} bytes)`)
  await rename(temporaryOutput, output)
  process.stdout.write(`Prepared local 4K H.264 wallpaper at 30 fps (${prepared.size.toLocaleString()} bytes).\n`)
} finally {
    await Promise.all([
      rm(source, { force: true }),
      rm(temporaryOutput, { force: true }),
    ])
  }
}

await prepare()
