import { describe, expect, it } from "vitest";
import { isBlockedIpv4, isBlockedIpv6 } from "./ipRanges.js";

describe("isBlockedIpv4", () => {
  it.each([
    ["169.254.169.254", "cloud metadata endpoint"],
    ["169.254.0.1", "link-local"],
    ["10.0.0.1", "RFC1918 10/8"],
    ["10.255.255.255", "RFC1918 10/8 upper bound"],
    ["172.16.0.1", "RFC1918 172.16/12 lower bound"],
    ["172.31.255.255", "RFC1918 172.16/12 upper bound"],
    ["192.168.0.1", "RFC1918 192.168/16"],
    ["192.168.255.255", "RFC1918 192.168/16 upper bound"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback upper bound"],
    ["0.0.0.0", "this-network"],
    ["100.64.0.1", "shared address space / CGNAT"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIpv4(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8", "public DNS"],
    ["1.1.1.1", "public DNS"],
    ["93.184.216.34", "example.com (public)"],
    ["172.15.255.255", "just below the RFC1918 172.16/12 range"],
    ["172.32.0.0", "just above the RFC1918 172.16/12 range"],
    ["169.253.255.255", "just below link-local"],
    ["169.255.0.0", "just above link-local"],
  ])("allows %s (%s)", (ip) => {
    expect(isBlockedIpv4(ip)).toBe(false);
  });
});

describe("isBlockedIpv6", () => {
  it.each([
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fe80::abcd:1234", "link-local, non-trivial suffix"],
    ["fc00::1", "unique local (ULA)"],
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "ULA upper bound"],
    ["ff02::1", "multicast"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata endpoint"],
    ["::ffff:10.0.0.1", "IPv4-mapped RFC1918"],
    ["::ffff:192.168.1.1", "IPv4-mapped RFC1918"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIpv6(ip)).toBe(true);
  });

  it.each([
    ["2001:4860:4860::8888", "public (Google DNS)"],
    ["::ffff:8.8.8.8", "IPv4-mapped public address"],
    ["2606:4700:4700::1111", "public (Cloudflare DNS)"],
  ])("allows %s (%s)", (ip) => {
    expect(isBlockedIpv6(ip)).toBe(false);
  });
});
