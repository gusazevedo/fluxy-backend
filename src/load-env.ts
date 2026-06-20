/**
 * Loads `.env` into `process.env` for local development.
 *
 * Imported as the very first import in `server.ts` so the file is read before
 * any config module evaluates. In deployed stages the variables come from the
 * Lambda configuration, so a missing `.env` is expected and ignored.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env file present — fall back to the ambient process environment.
}
