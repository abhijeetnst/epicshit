import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent's event stream is proxied as SSE; gzip would buffer it.
  compress: false,
  poweredByHeader: false,
  // The dev server is bound to 127.0.0.1; let http://localhost:3000 load dev assets too.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
