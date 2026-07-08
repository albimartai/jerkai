import { neon } from "@neondatabase/serverless";

// Lazy so the module can be imported at build time without DATABASE_URL;
// the env var is only required when a query actually runs.
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(url);
}
