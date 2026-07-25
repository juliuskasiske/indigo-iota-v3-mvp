import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static site — exported to ./out and served by Cloudflare Pages.
  // The whole demo is client-side (no API routes / server data), so this
  // works cleanly. Dynamic project pages use query params (/projects/view?id=)
  // so a single static page resolves any id client-side.
  output: "export",

  // next/image optimization needs a server; disable it for static export.
  images: { unoptimized: true },

  // Emit /route/index.html (instead of /route.html) so Cloudflare Pages
  // serves clean URLs without extra redirect config.
  trailingSlash: true,
};

export default nextConfig;
