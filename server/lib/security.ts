import type { NextFunction, Request, Response } from "express";

/**
 * Request guards for a server that holds API keys and runs agents on them.
 *
 * The API is meant for the person at this machine. Binding to loopback keeps
 * other devices on the network out; these guards cover what binding cannot:
 *   - DNS rebinding: a web page whose domain is re-pointed at 127.0.0.1 would
 *     otherwise be "same origin" with this API. Its requests still carry the
 *     attacker's host name in the Host header, so unknown hosts are refused.
 *   - Cross-site requests: another site open in the same browser can send
 *     requests here. Anything that changes state or spends a key must come from
 *     this app's own origin.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host name without the port, lowercased; IPv6 literals keep their brackets. */
export function hostName(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  const name = h.split(":")[0]!;
  return name || null;
}

export function isAllowedHost(hostHeader: string | undefined, extra: string[]): boolean {
  const name = hostName(hostHeader);
  if (!name) return false;
  if (LOOPBACK_HOSTS.has(name) || name.endsWith(".localhost")) return true;
  return extra.some((h) => h.toLowerCase() === name);
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Refuses requests addressed to a host this server does not answer for. */
export function hostGuard(getExtraHosts: () => string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAllowedHost(req.headers.host, getExtraHosts())) return next();
    res.status(403).json({ error: "This server only answers requests addressed to localhost. Add the host name to ALLOWED_HOSTS to serve it elsewhere." });
  };
}

/**
 * Refuses state-changing requests that another site started. Browsers mark
 * them with Sec-Fetch-Site; older ones still send Origin, which must be an
 * allowed host. Requests with neither header (curl, scripts on this machine)
 * pass, because the host guard and loopback binding already bound who that is.
 */
export function crossSiteGuard(getExtraHosts: () => string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const site = req.headers["sec-fetch-site"];
    if (site === "cross-site") return refuse(res);
    const origin = req.headers.origin;
    if (origin && origin !== "null" && !isAllowedHost(originHost(origin) ?? undefined, getExtraHosts())) return refuse(res);
    if (origin === "null") return refuse(res);
    next();
  };
}

function refuse(res: Response): void {
  res.status(403).json({ error: "Cross-site requests are refused. Open the app from its own address." });
}

/** Security headers for every response. The app has no reason to be framed or sniffed. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

/** True for addresses that only this machine can use. */
export function isLoopbackBind(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
