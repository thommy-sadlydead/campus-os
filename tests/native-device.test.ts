import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeDevice } from "../src/lib/native-app";

// The app says "ios" on iPhone, iPad and Mac (Mac Catalyst), so wording like
// "Saved on this Mac" comes from the user agent and the touch screen.
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CampusOSApp/1",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CampusOSApp/1",
};

afterEach(() => vi.unstubAllGlobals());

describe("nativeDevice", () => {
  it("knows an iPhone", () => {
    vi.stubGlobal("navigator", { userAgent: UA.iphone, maxTouchPoints: 5 });
    expect(nativeDevice()).toBe("iPhone");
  });

  it("tells an iPad, whose web view says Macintosh too, from a Mac by its touch screen", () => {
    vi.stubGlobal("navigator", { userAgent: UA.desktop, maxTouchPoints: 5 });
    expect(nativeDevice()).toBe("iPad");
    vi.stubGlobal("navigator", { userAgent: UA.desktop, maxTouchPoints: 0 });
    expect(nativeDevice()).toBe("Mac");
  });
});
