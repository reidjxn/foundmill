import { describe, expect, it } from "vitest";
import { parseStoreLinks } from "../app-links";

const IOS = "https://apps.apple.com/us/app/foundmill/id1234567890";
const ANDROID = "https://play.google.com/store/apps/details?id=com.foundmill.app";

describe("parseStoreLinks (NEXT_PUBLIC_STORE_LINKS)", () => {
  it("is null while unset or empty", () => {
    expect(parseStoreLinks(undefined)).toBeNull();
    expect(parseStoreLinks(null)).toBeNull();
    expect(parseStoreLinks("")).toBeNull();
    expect(parseStoreLinks(" , ")).toBeNull();
  });

  it("takes one link on its own", () => {
    expect(parseStoreLinks(IOS)).toEqual({ ios: IOS, android: null });
    expect(parseStoreLinks(` ${ANDROID} `)).toEqual({ ios: null, android: ANDROID });
  });

  it("takes both, in either order", () => {
    expect(parseStoreLinks(`${IOS},${ANDROID}`)).toEqual({ ios: IOS, android: ANDROID });
    expect(parseStoreLinks(`${ANDROID} , ${IOS}`)).toEqual({ ios: IOS, android: ANDROID });
  });

  it("is null when any part points anywhere else, or is not https", () => {
    expect(parseStoreLinks("https://example.com/app")).toBeNull();
    expect(parseStoreLinks(`${IOS},https://example.com/app`)).toBeNull();
    expect(parseStoreLinks("http://apps.apple.com/us/app/foundmill/id1")).toBeNull();
    expect(parseStoreLinks("https://apps.apple.com.evil.example/app")).toBeNull();
    expect(parseStoreLinks("https://user@play.google.com/store/apps/details?id=x")).toBeNull();
    expect(parseStoreLinks("https://apps.apple.com/")).toBeNull();
    expect(parseStoreLinks("not a link")).toBeNull();
  });

  it("is null with two links to one store or more than two parts", () => {
    expect(parseStoreLinks(`${IOS},${IOS}`)).toBeNull();
    expect(parseStoreLinks(`${IOS},${ANDROID},${IOS}`)).toBeNull();
  });
});
