/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["react-pdf", "pdfjs-dist"],
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers", "onnxruntime-node"],
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false
    return config
  },
};

module.exports = nextConfig;
