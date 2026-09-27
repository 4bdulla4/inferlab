import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { crossSiteGuard, hostGuard, hostName, isAllowedHost } from "./security";

function run(mw: (req: Request, res: Response, next: NextFunction) => void, req: Partial<Request>): number {
  let status = 0;
  const res = { status: (s: number) => ((status = s), res), json: () => res } as unknown as Response;
  mw({ method: "GET", headers: {}, ...req } as Request, res, () => (status = 200));
  return status;
}

describe("host guard (DNS rebinding)", () => {
  it("parses host names with ports and IPv6 literals", () => {
    expect(hostName("LocalHost:5173")).toBe("localhost");
    expect(hostName("[::1]:8790")).toBe("[::1]");
    expect(hostName("")).toBeNull();
  });
  it("answers loopback names and configured hosts only", () => {
    for (const h of ["localhost:5173", "127.0.0.1:8790", "[::1]:8790", "app.localhost"]) expect(isAllowedHost(h, [])).toBe(true);
    expect(isAllowedHost("evil.example:8790", [])).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.example", [])).toBe(false);
    expect(isAllowedHost(undefined, [])).toBe(false);
    expect(isAllowedHost("lab.example.com", ["lab.example.com"])).toBe(true);
    expect(run(hostGuard(() => []), { headers: { host: "rebind.attacker.test:8790" } })).toBe(403);
    expect(run(hostGuard(() => []), { headers: { host: "localhost:8790" } })).toBe(200);
  });
});

describe("cross-site guard", () => {
  const guard = crossSiteGuard(() => []);
  it("refuses state-changing requests started by another site", () => {
    expect(run(guard, { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).toBe(403);
    expect(run(guard, { method: "POST", headers: { origin: "https://evil.example" } })).toBe(403);
    expect(run(guard, { method: "POST", headers: { origin: "null" } })).toBe(403);
  });
  it("lets the app's own requests, reads and local scripts through", () => {
    expect(run(guard, { method: "POST", headers: { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" } })).toBe(200);
    expect(run(guard, { method: "GET", headers: { "sec-fetch-site": "cross-site" } })).toBe(200);
    expect(run(guard, { method: "POST", headers: {} })).toBe(200);
  });
});
