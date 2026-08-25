import "server-only"
import path from "path"
import { UPLOAD_DIR } from "@/lib/constants"

/**
 * Resolve the upload directory to an absolute path.
 *
 * A relative "./uploads" is interpreted against the process working directory,
 * which under PM2/systemd is often not the project root — uploads then land
 * in one folder and are served from another, so freshly uploaded avatars 404.
 */
export function uploadsDir(): string {
  return path.isAbsolute(UPLOAD_DIR) ? UPLOAD_DIR : path.resolve(/* turbopackIgnore: true */ process.cwd(), UPLOAD_DIR)
}
