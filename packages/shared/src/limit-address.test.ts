import { describe, expect, it } from "vitest";
import { limitAddress } from "./limit-address";

describe("limitAddress (security review P2-2)", () => {
  it("counts an IPv6 address by its /64, an IPv4-mapped one as IPv4, and IPv4 as it is", () => {
    expect(limitAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(limitAddress(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(limitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(limitAddress("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(limitAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(limitAddress("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(limitAddress("2001:DB8:0001:0002:ffff::1")).toBe("2001:db8:1:2::/64");
    expect(limitAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(limitAddress("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(limitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(limitAddress("::1")).toBe("0:0:0:0::/64");
    expect(limitAddress("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });

  it("puts every address of one /64 together and two /64s apart", () => {
    expect(new Set(["2001:db8:5:6::1", "2001:db8:5:6::2", "2001:db8:5:6:ffff:1:2:3", "2001:0db8:0005:0006:0:0:0:9"].map(limitAddress)).size).toBe(1);
    expect(limitAddress("2001:db8:5:6::1")).not.toBe(limitAddress("2001:db8:5:7::1"));
  });

  it("leaves anything that is not an IP address as it is, lowercased", () => {
    expect(limitAddress("Unknown")).toBe("unknown");
    expect(limitAddress("1::2::3")).toBe("1::2::3");
    expect(limitAddress("zz:1::")).toBe("zz:1::");
    expect(limitAddress("")).toBe("");
  });
});
