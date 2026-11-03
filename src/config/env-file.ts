/**
 * Loads the local `.env` (gitignored) into `process.env` for the scripts
 * that run on a developer's machine. Variables already in the environment
 * win: Node's loader doesn't override them. No file is fine: CI and replay
 * run without one.
 */
export function loadLocalEnvFile(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
