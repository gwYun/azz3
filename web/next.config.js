/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/predict",
        destination: "http://127.0.0.1:8000/api/predict",
      },
    ];
  },
};

module.exports = nextConfig;
