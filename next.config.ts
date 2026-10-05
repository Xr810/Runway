import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  // The orb portal proxies the dev server through a different hostname.
  allowedDevOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).hostname] : [],
  // Opt-in portal preview: smaller chunks, but edits can trigger full page reloads.
  // Keep normal local development and production build settings untouched.
  ...(process.env.NODE_ENV === "development" && process.env.RUNWAY_FAST_DEV === "1"
    ? { experimental: { turbopackMinify: true } }
    : {}),
};

export default nextConfig;
