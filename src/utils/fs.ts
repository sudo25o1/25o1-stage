import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Perform an atomic write to a file by writing to a temporary file first
 * and then renaming it.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Get the current user's home directory.
 */
export function getHomeDir(): string {
  // Respect process.env.HOME if overridden (e.g., in tests),
  // otherwise fallback to os.homedir().
  return process.env.HOME || os.homedir();
}
