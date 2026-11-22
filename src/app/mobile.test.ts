import { describe, expect, it } from "vitest";
import { isMobileDevice } from "./mobile.ts";

const desktop = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

describe("isMobileDevice", () => {
  it("counts phones and tablets", () => {
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
          5,
        ),
      ),
    ).toBe(true);
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
          5,
        ),
      ),
    ).toBe(true);
    // An Android tablet's Chrome says "Android" without "Mobile"
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
          5,
        ),
      ),
    ).toBe(true);
    // An iPad asks for desktop sites, saying it's a Mac
    expect(
      isMobileDevice({
        ...desktop(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
          5,
        ),
        coarsePointer: true,
      }),
    ).toBe(true);
    // Chromium's client hints, even with a desktop user agent
    expect(
      isMobileDevice({
        ...desktop("Mozilla/5.0 (X11; Linux x86_64)"),
        userAgentData: { mobile: true },
      }),
    ).toBe(true);
  });

  it("doesn't count computers, the Steam Deck, or touchscreen laptops", () => {
    // The Steam Deck's browsers, in desktop and game mode, say Linux on x86_64, with a touchscreen
    expect(
      isMobileDevice({
        ...desktop(
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
          10,
        ),
        userAgentData: { mobile: false },
      }),
    ).toBe(false);
    expect(
      isMobileDevice(
        desktop("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", 10),
      ),
    ).toBe(false);
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
          10,
        ),
      ),
    ).toBe(false);
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        ),
      ),
    ).toBe(false);
    // A touchscreen MacBook: its main pointer is the trackpad
    expect(
      isMobileDevice(
        desktop(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
          10,
        ),
      ),
    ).toBe(false);
    // Chrome on one, even if it reports a coarse pointer, sends client hints
    expect(
      isMobileDevice({
        ...desktop(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
          10,
        ),
        userAgentData: { mobile: false },
        coarsePointer: true,
      }),
    ).toBe(false);
    expect(isMobileDevice(undefined)).toBe(false);
  });
});
