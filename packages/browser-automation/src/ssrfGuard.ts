import dns from "node:dns/promises";
import net from "node:net";
import { isBlockedIpv4, isBlockedIpv6 } from "./ipRanges.js";

export interface SsrfCheckResult {
  blocked: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

/**
 * Resolves the hostname and checks the *resolved* IP addresses against
 * the blocklist — never just the hostname string. Checking the string
 * alone is a well-known SSRF bypass (DNS rebinding: a hostname that
 * resolves to 169.254.169.254 or a private IP) — docs/security-model.md
 * §7. Fails closed: DNS failures, malformed URLs, and non-HTTP(S)
 * schemes are all treated as blocked.
 */
export async function checkUrlAllowed(urlString: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { blocked: true, reason: "Invalid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { blocked: true, reason: `Protocol "${url.protocol}" is not allowed.` };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { blocked: true, reason: `Host "${hostname}" is blocked.` };
  }

  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const results = await dns.lookup(hostname, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      return { blocked: true, reason: "DNS resolution failed." };
    }
  }

  if (addresses.length === 0) {
    return { blocked: true, reason: "Host did not resolve to any address." };
  }

  for (const address of addresses) {
    const blocked = net.isIPv6(address) ? isBlockedIpv6(address) : isBlockedIpv4(address);
    if (blocked) {
      return { blocked: true, reason: `Host resolves to a blocked address (${address}).` };
    }
  }

  return { blocked: false };
}
