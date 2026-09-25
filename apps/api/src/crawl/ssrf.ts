import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";

/** Hostnames that must never be fetched regardless of what they resolve to. */
const BLOCKED_HOSTS = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google\.internal)?$/i, /\.svc(\.cluster\.local)?$/i, /^instance-data$/i];
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** True for loopback, private, link-local (incl. 169.254.169.254 metadata), CGNAT, multicast, reserved… */
export function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  return addr.range() !== "unicast";
}

export function validateUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("Only http and https URLs are allowed");
  if (url.username || url.password) throw new SsrfError("Credentials in URLs are not allowed");
  if (!ALLOWED_PORTS.has(url.port)) throw new SsrfError("Port not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.some((re) => re.test(host))) throw new SsrfError("Host not allowed");
  if (net.isIP(host) && isBlockedIp(host)) throw new SsrfError("Address not allowed");
  if (!net.isIP(host) && !host.includes(".")) throw new SsrfError("Single-label hostnames are not allowed");
  return url;
}

/**
 * DNS lookup used by the crawler's HTTP agent. Resolution and validation happen at connect
 * time on the exact address used, which defeats DNS-rebinding between check and connect.
 */
export function safeLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = addresses as dns.LookupAddress[];
      const ok = allowPrivate ? list : list.filter((a) => !isBlockedIp(a.address));
      if (!ok.length) return callback(new SsrfError(`Resolved address for ${hostname} is not allowed`) as NodeJS.ErrnoException, "", 4);
      if (options.all) return callback(null, ok);
      callback(null, ok[0]!.address, ok[0]!.family);
    });
  };
}
