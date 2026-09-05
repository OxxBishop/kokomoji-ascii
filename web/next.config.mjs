import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo root also has a lockfile (for the conversion scripts); pin tracing
  // to web/ so Next does not infer the wrong workspace root.
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
