import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One .env at the repo root configures every app (local dev). Containers get env from compose.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (existsSync(path.join(root, ".env"))) {
  const before = { ...process.env };
  process.loadEnvFile(path.join(root, ".env"));
  Object.assign(process.env, before);
}

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@jobagent/shared"],
  // The browser always talks to its own origin; in dev Next proxies /api to Express.
  // In Docker, Caddy routes /api before requests reach Next.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
