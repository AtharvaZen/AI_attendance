import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev HMR websocket rejects upgrades whose Origin is not `localhost`
  // (e.g. opening the app as http://127.0.0.1:3000) - the socket is closed
  // with a bare "Unauthorized" instead of an HTTP response. With React 19.2's
  // debug-channel feature a dead websocket silently blocks hydration forever:
  // the page renders but nothing works, with no console error
  // (https://github.com/vercel/next.js/discussions/91770).
  // Entries are bare hostnames - no scheme, no port.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
