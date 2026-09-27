/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // The news hub was renamed to /reports (리포트/Report). Keep old links alive.
    return [
      { source: "/news", destination: "/reports", permanent: true },
      { source: "/news/:path*", destination: "/reports/:path*", permanent: true },
    ];
  },
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
