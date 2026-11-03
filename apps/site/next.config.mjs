/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  devIndicators: false,
  // Pure static files: no Node at runtime, deployable to any static host.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@knitted/ui"],
};
