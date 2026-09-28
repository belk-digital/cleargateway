import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { sameOrigin } from "./csrf";

const req = (headers: Record<string, string>) => new NextRequest("http://localhost:3001/api/proxy/admin/merchants", { method: "POST", headers });

describe("sameOrigin (CSRF guard)", () => {
  it("requires the custom header", () => {
    expect(sameOrigin(req({}))).toBe(false);
    expect(sameOrigin(req({ "x-cleargateway-csrf": "0" }))).toBe(false);
    expect(sameOrigin(req({ "x-cleargateway-csrf": "1" }))).toBe(true);
  });
  it("rejects a foreign Origin even with the header", () => {
    expect(sameOrigin(req({ "x-cleargateway-csrf": "1", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ "x-cleargateway-csrf": "1", origin: "http://localhost:3001" }))).toBe(true);
  });
});
