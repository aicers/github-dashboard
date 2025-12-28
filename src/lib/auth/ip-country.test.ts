import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

describe("ip country helpers", () => {
  it("normalizes the first valid request header", async () => {
    const { readIpCountryFromRequest } = await import("./ip-country");
    const request = new NextRequest("http://localhost", {
      headers: {
        "x-vercel-ip-country": " usa ",
        "cf-ipcountry": "kr",
      },
    });

    expect(readIpCountryFromRequest(request)).toBe("KR");
  });

  it("skips invalid header values and falls through", async () => {
    const { readIpCountryFromRequest } = await import("./ip-country");
    const request = new NextRequest("http://localhost", {
      headers: {
        "x-vercel-ip-country": "usa",
        "cf-ipcountry": "jp",
      },
    });

    expect(readIpCountryFromRequest(request)).toBe("JP");
  });

  it("reads country from header store in order", async () => {
    const headersMock = vi.mocked(await import("next/headers")).headers;
    headersMock.mockResolvedValue(
      new Headers({
        "x-vercel-ip-country": "br",
      }),
    );

    const { readIpCountryFromHeaders } = await import("./ip-country");
    const country = await readIpCountryFromHeaders();
    expect(country).toBe("BR");
  });
});
