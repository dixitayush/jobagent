import { Agent, fetch as undiciFetch } from "undici";
import { env } from "../config/env";
import { safeLookup, SsrfError, validateUrlShape } from "./ssrf";

const agent = new Agent({
  connect: { lookup: safeLookup(env.CRAWL_ALLOW_PRIVATE_NETWORKS), timeout: 10_000 },
  connections: 16,
  headersTimeout: env.CRAWL_TIMEOUT_MS,
  bodyTimeout: env.CRAWL_TIMEOUT_MS,
});

export interface SafeResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
  notModified: boolean;
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * The only way crawlers touch the network. Enforces: http/https only, blocked private/meta
 * addresses (checked at connect time), manual redirect re-validation, response size cap,
 * timeout, conditional requests (ETag / Last-Modified). Never executes page JavaScript.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  let url = env.CRAWL_ALLOW_PRIVATE_NETWORKS ? new URL(rawUrl) : validateUrlShape(rawUrl);
  const maxBytes = opts.maxBytes ?? env.CRAWL_MAX_BYTES;
  const headers: Record<string, string> = {
    "user-agent": env.CRAWLER_USER_AGENT,
    accept: "application/json, text/html;q=0.9, */*;q=0.5",
    ...opts.headers,
  };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  let method = opts.method ?? "GET";
  let body = opts.body;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const res = await undiciFetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
      dispatcher: agent,
      signal: AbortSignal.timeout(opts.timeoutMs ?? env.CRAWL_TIMEOUT_MS),
    }).catch((err: Error & { cause?: unknown }) => {
      if (err.cause instanceof SsrfError) throw err.cause;
      throw err;
    });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new HttpError(res.status, "Redirect without location");
      const next = new URL(loc, url);
      url = env.CRAWL_ALLOW_PRIVATE_NETWORKS ? next : validateUrlShape(next.toString());
      if (res.status === 303) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    if (res.status === 304) {
      await res.body?.cancel();
      return { status: 304, url: url.toString(), headers: res.headers as unknown as Headers, body: "", notModified: true };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new HttpError(413, "Response too large");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new HttpError(413, "Response too large");
        chunks.push(chunk);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (res.status >= 400) throw new HttpError(res.status, `HTTP ${res.status} from ${url.hostname}`);
    return { status: res.status, url: url.toString(), headers: res.headers as unknown as Headers, body: text, notModified: false };
  }
  throw new HttpError(310, "Too many redirects");
}

export async function fetchJson<T>(url: string, opts: SafeFetchOptions = {}): Promise<{ data: T | null; res: SafeResponse }> {
  const res = await safeFetch(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  if (res.notModified) return { data: null, res };
  try {
    return { data: JSON.parse(res.body) as T, res };
  } catch {
    throw new HttpError(502, `Invalid JSON from ${new URL(url).hostname}`);
  }
}
