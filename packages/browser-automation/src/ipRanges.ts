/**
 * Hand-rolled CIDR matching (no dependency) for the SSRF guard. Kept
 * small and heavily unit-tested since correctness here is
 * security-critical — docs/security-model.md §7.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1) >>> 0) & 0xffffffff;
  return (ipInt & mask) === (baseInt & mask);
}

// RFC1918 private ranges, loopback, link-local (includes the
// 169.254.169.254 cloud metadata endpoint), and other non-routable
// ranges that should never be reachable from agent-initiated browsing.
const IPV4_BLOCKED_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isBlockedIpv4(ip: string): boolean {
  return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function expandIpv6(ip: string): string[] | null {
  // Dotted-decimal IPv4 suffix (e.g. ::ffff:192.168.1.1) isn't valid
  // hextet syntax on its own — rewrite it to two hex groups first.
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes(".")) {
    const v4Int = ipv4ToInt(ip.slice(lastColon + 1));
    if (v4Int === null) return null;
    const high = ((v4Int >>> 16) & 0xffff).toString(16);
    const low = (v4Int & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  let groups: string[];
  if (parts.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }

  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups;
}

function ipv6ToBigInt(groups: string[]): bigint {
  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const prefix = BigInt(prefixStr);
  const ipGroups = expandIpv6(ip);
  const baseGroups = expandIpv6(base);
  if (!ipGroups || !baseGroups) return false;
  const ipBig = ipv6ToBigInt(ipGroups);
  const baseBig = ipv6ToBigInt(baseGroups);
  if (prefix === 0n) return true;
  const fullMask = (1n << 128n) - 1n;
  const mask = prefix === 128n ? fullMask : (fullMask << (128n - prefix)) & fullMask;
  return (ipBig & mask) === (baseBig & mask);
}

// Loopback, link-local, and unique-local (RFC4193 — the IPv6 analogue
// of RFC1918 private space) plus unspecified/multicast.
const IPV6_BLOCKED_CIDRS = ["::1/128", "::/128", "fe80::/10", "fc00::/7", "ff00::/8"];

export function isBlockedIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return false;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) must be checked against the IPv4
  // ranges too — otherwise it's a straightforward SSRF bypass.
  const isV4Mapped = groups.slice(0, 5).every((g) => parseInt(g, 16) === 0) && parseInt(groups[5], 16) === 0xffff;
  if (isV4Mapped) {
    const high = parseInt(groups[6], 16);
    const low = parseInt(groups[7], 16);
    const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isBlockedIpv4(v4);
  }

  return IPV6_BLOCKED_CIDRS.some((cidr) => ipv6InCidr(ip, cidr));
}
