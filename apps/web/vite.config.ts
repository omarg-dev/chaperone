import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the server runs on its own port (pnpm dev) and Vite proxies the API to it, so the
// app calls relative URLs exactly as it does when the server serves it. /arena is both an API prefix
// and a page of the app: a browser navigation (it accepts HTML) gets the app, anything else the API.
const target = `http://localhost:${process.env.PORT ?? 3000}`;
const apiOnly = (request: { headers: { accept?: string } }) =>
  request.headers.accept?.includes("text/html") ? "/index.html" : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/health": target,
      "/events": { target, bypass: apiOnly },
      "/arena": { target, bypass: apiOnly },
    },
  },
});
