import { resolve } from 'node:path';

// Best-effort load of a local .env (for `just cap-serve` / `just cap-seed`).
// In the add-on, options come from Supervisor via run.sh, so there is no .env
// and this is a no-op.
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(__dirname, '..', '.env'));
  } catch {
    // no .env — rely on the ambient environment
  }
}
