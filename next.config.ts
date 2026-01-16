import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Copy PDF.js worker to public folder during build
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Ensure pdf.worker.min.mjs is handled properly
      config.resolve.alias['pdfjs-dist/build/pdf.worker.entry'] = 
        'pdfjs-dist/build/pdf.worker.min.mjs';
    }
    return config;
  },
};

export default nextConfig;
