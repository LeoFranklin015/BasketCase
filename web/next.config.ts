import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root holds deployments/testnet.json and constants.json, which the app imports.
  turbopack: { root: path.join(__dirname, "..") },
  transpilePackages: ["@backed/client"],
  reactStrictMode: true,
  // Don't write AGENTS.md into the app folder on dev/build.
  agentRules: false,
  // A separate output folder lets the fixture-mode e2e build run next to a normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // /widget/<coin> is the embeddable card for any site's iframe: any page may frame it, and it never signs there.
  // /x/<coin> is the X player card, which buys and sells inside the post: only X may frame it.
  // Everything else may only be framed by this site.
  async headers() {
    const X = "https://x.com https://*.x.com https://twitter.com https://*.twitter.com";
    return [
      { source: "/widget/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/x/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${X}` }] },
      { source: "/((?!widget/|x/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
    ];
  },
};

export default nextConfig;
