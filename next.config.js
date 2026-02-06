/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ne pas bundler @xenova/transformers et onnxruntime-node (binaire .node) — chargés à l’exécution par Node.
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers", "onnxruntime-node"],
  },
};

module.exports = nextConfig;
