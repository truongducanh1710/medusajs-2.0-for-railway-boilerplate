const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: process.env.NEXT_PUBLIC_BASE_URL?.startsWith('https') ? 'https' : 'http',
        hostname: process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\//, ''),
      },
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL?.replace('https://', ''),
      },
      // MinIO / Railway bucket
      {
        protocol: "https",
        hostname: "bucket-production-2a92.up.railway.app",
      },
      ...(process.env.NEXT_PUBLIC_MINIO_ENDPOINT ? [{
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_MINIO_ENDPOINT.replace(/^https?:\/\//, ''),
      }] : []),
    ],
  },
  serverRuntimeConfig: {
    port: process.env.PORT || 3000
  }
}

module.exports = nextConfig
