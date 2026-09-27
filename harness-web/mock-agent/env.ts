// Loads .env.local / .env so the agent sees the same settings (e.g.
// DOPECODE_AGENT_TOKEN) as the web app. Imported first by server.ts, before any
// module reads process.env. Variables already set in the shell win.

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file: nothing to load.
  }
}
