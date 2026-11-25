export interface Env {
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;
  DB?: D1Database;
  LEGACY_ORIGIN?: string;
}

const LEGACY_PATHS = [
  "/register",
  "/login",
  "/chats",
  "/messages",
  "/user",
  "/users",
  "/stories",
  "/groups",
  "/friends",
  "/update-profile",
  "/update-password",
  "/delete-account",
  "/uploads",
  "/avatars",
  "/cinema",
  "/stickers",
  "/block",
  "/unblock",
  "/blocks",
  "/report",
  "/ban-status",
  "/appeal",
  "/admin",
  "/socket.io",
];

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Username");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Vary", "Origin");
  return headers;
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isLegacyPath(pathname: string): boolean {
  return LEGACY_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function mediaKey(pathname: string): string | null {
  const match = pathname.match(/^\/(uploads|avatars)\/(.+)$/);
  if (!match) return null;
  const key = decodeURIComponent(match[2]).replace(/^\/+/, "");
  if (!key || key.includes("..")) return null;
  return `${match[1]}/${key}`;
}

async function serveMedia(request: Request, env: Env): Promise<Response | null> {
  if (!env.MEDIA || request.method !== "GET" && request.method !== "HEAD") return null;
  const key = mediaKey(new URL(request.url).pathname);
  if (!key) return null;
  const object = await env.MEDIA.get(key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function proxyLegacy(request: Request, env: Env): Promise<Response> {
  const origin = env.LEGACY_ORIGIN?.replace(/\/+$/, "");
  if (!origin) {
    return json({
      error: "Rota ainda não migrada para Workers",
      code: "LEGACY_ORIGIN_NOT_CONFIGURED",
    }, 501);
  }
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, `${origin}/`);
  const proxied = new Request(target, request);
  return fetch(proxied);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    if (url.pathname === "/api/healthz" || url.pathname === "/__worker_health") {
      return withCors(json({
        status: "ok",
        runtime: "cloudflare-workers",
        mode: env.LEGACY_ORIGIN ? "compatibility-proxy" : "migration-edge",
        bindings: { d1: Boolean(env.DB), r2: Boolean(env.MEDIA) },
      }), request);
    }

    const media = await serveMedia(request, env);
    if (media) return withCors(media, request);

    if (isLegacyPath(url.pathname)) {
      return withCors(await proxyLegacy(request, env), request);
    }

    return env.ASSETS.fetch(request);
  },
};
