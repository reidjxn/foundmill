/**
 * `buildUrl` (SECURITY_REVIEW SEC-16): a connector's client carries the credential in its headers, so a whole URL is
 * followed only over https and only on the connector's own host. Relative paths join the base as before.
 */
import { describe, expect, it } from "vitest";
import { buildUrl, createHttp } from "../http";

describe("buildUrl", () => {
  it("joins a relative path and its query to the base", () => {
    expect(buildUrl("https://api.example.com/v1/", "/customers", { limit: 2, tag: ["a", "b"], skip: undefined })).toBe("https://api.example.com/v1/customers?limit=2&tag=a&tag=b");
    // a relative path that merely starts with the letters "http" is a path, not a URL
    expect(buildUrl("https://api.example.com", "httpbin/status")).toBe("https://api.example.com/httpbin/status");
  });

  it("follows a vendor's own absolute link on the same host over https", () => {
    expect(buildUrl("https://api.example.com/v1", "https://api.example.com/v1/customers?starting_after=cus_1")).toBe("https://api.example.com/v1/customers?starting_after=cus_1");
  });

  it("refuses another host, plain http, a metadata address and other schemes", () => {
    for (const path of ["https://evil.example.net/x", "http://api.example.com/v1/x", "http://169.254.169.254/latest/meta-data/", "https://169.254.169.254/", "file:///etc/passwd", "HTTPS://API.EXAMPLE.COM.evil.test/"]) {
      expect(() => buildUrl("https://api.example.com/v1", path), path).toThrow(/outside the connector's host refused/);
    }
  });

  it("the client never sends its headers to a refused URL", async () => {
    const seen: string[] = [];
    const http = createHttp({ connectorKey: "test", baseUrl: "https://api.example.com", headers: { authorization: "Bearer secret" }, fetch: (async (url: string) => (seen.push(String(url)), new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))) as never });
    await expect(http.json("GET", "https://evil.example.net/steal")).rejects.toThrow(/refused/);
    expect(seen).toEqual([]);
    await http.json("GET", "/ok");
    expect(seen).toEqual(["https://api.example.com/ok"]);
  });
});
