import server from "../../dist/server/index.js";

// The TanStack Start server bundle (built via the Cloudflare/Vite plugin) exposes a
// Web-standard `fetch` handler. Netlify Functions natively speak Request/Response, so
// we can hand the incoming request straight through and return the SSR Response as-is.
const serverEntry = server as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

export default async function handler(request: Request): Promise<Response> {
  return serverEntry.fetch(request, {}, {});
}
