import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@tpv/shared"],
  poweredByHeader: false,
  experimental: { cpus: 2 },
};
export default config;
