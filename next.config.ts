import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A static site in out/: the editor runs entirely in the browser, and our
  // host (AWS Amplify) serves it as static files.
  output: "export",
  // Turbopack names static chunks by module path, not content, so a chunk
  // such as globals.css keeps its URL from one build to the next. Vercel
  // serves those URLs from an immutable CDN cache, and a new deployment's
  // HTML then loads the previous deployment's stylesheet. The deployment id
  // becomes a query on every asset URL, so each deployment gets its own.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  experimental: {
    optimizePackageImports: ["@xyflow/react"],
  },
};

export default nextConfig;
