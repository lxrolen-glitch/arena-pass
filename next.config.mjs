/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === "production";

const nextConfig = {
  reactStrictMode: true,
  // Keep the production build out of the dev server's directory so running
  // `npm run build` while `npm run dev` is up cannot corrupt either one.
  distDir: isProduction ? ".next-prod" : ".next",
  // The Socket.IO server runs inside the custom server (server.ts) on the same
  // port, so nothing else is needed here.
};

export default nextConfig;
