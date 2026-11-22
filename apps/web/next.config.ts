import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@spark/db", "@spark/sandbox", "@spark/shared"],
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  async headers() {
    const crossOriginIsolationHeaders = [
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "credentialless",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
    ];

    return [
      {
        source: "/sandbox/:path*",
        headers: crossOriginIsolationHeaders,
      },
      {
        source: "/sandbox",
        headers: crossOriginIsolationHeaders,
      },
      {
        source: "/projects/:path*",
        headers: crossOriginIsolationHeaders,
      },
      {
        source: "/projects",
        headers: crossOriginIsolationHeaders,
      },
    ];
  },
};

export default nextConfig;
