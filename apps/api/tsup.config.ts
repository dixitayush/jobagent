import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts", "src/scheduler.ts", "src/db/migrate.ts", "src/db/seed.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  // Bundle the workspace contract package; keep real npm deps external.
  noExternal: ["@jobagent/shared"],
});
