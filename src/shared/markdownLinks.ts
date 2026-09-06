export type MarkdownLinkIcon = 'github';

export const normalizeHostname = (host: string): string =>
  host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/u, '');

/**
 * Sites whose brand mark replaces the generic external-link glyph or fetched favicon.
 * The marks are monochrome and drawn in `currentColor` so they follow the theme
 * and require no network requests.
 * Ported from t3code PR #10324.
 */
export function resolveMarkdownLinkIcon(host: string | null | undefined): MarkdownLinkIcon | null {
  if (!host) return null;
  const hostname = normalizeHostname(host);
  if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
    return 'github';
  }
  return null;
}

const parseIpv4Address = (host: string): readonly number[] | null => {
  const parts = normalizeHostname(host).split('.').map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
};

const parseIpv4MappedIpv6Address = (host: string): readonly number[] | null => {
  const normalized = normalizeHostname(host);
  if (!normalized.startsWith('::ffff:')) return null;
  const suffix = normalized.slice('::ffff:'.length);
  const dotted = parseIpv4Address(suffix);
  if (dotted) return dotted;
  const hextets = suffix.split(':');
  if (hextets.length !== 2 || hextets.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
  const high = Number.parseInt(hextets[0]!, 16);
  const low = Number.parseInt(hextets[1]!, 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
};

const parseIpv6Address = (host: string): readonly number[] | null => {
  const normalized = normalizeHostname(host);
  if (!normalized.includes(':')) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...head, ...Array.from({ length: missing }, () => '0'), ...tail].map((part) =>
    Number.parseInt(part, 16)
  );
};

const ipv6PrefixMatches = (
  address: readonly number[],
  prefix: readonly number[],
  prefixLength: number
): boolean => {
  const fullHextets = Math.floor(prefixLength / 16);
  if (address.slice(0, fullHextets).some((part, index) => part !== prefix[index])) return false;
  const remainingBits = prefixLength % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (address[fullHextets]! & mask) === (prefix[fullHextets]! & mask);
};

const isPrivateIpv4Address = (parts: readonly number[]): boolean =>
  parts[0] === 0 ||
  parts[0] === 10 ||
  parts[0] === 127 ||
  (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
  (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
  (parts[0] === 192 && parts[1] === 168) ||
  (parts[0] === 169 && parts[1] === 254) ||
  (parts[0] === 198 && parts[1]! >= 18 && parts[1]! <= 19);

const isSpecialPurposeIpv4Address = (parts: readonly number[]): boolean =>
  isPrivateIpv4Address(parts) ||
  parts[0]! >= 224 ||
  (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
  (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
  (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
  (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
  (parts[0] === 203 && parts[1] === 0 && parts[2] === 113);

export const isLocalLoopbackHost = (host: string): boolean => {
  const normalized = normalizeHostname(host);
  if (normalized === 'localhost' || normalized === '::1') return true;
  return parseIpv4Address(normalized)?.[0] === 127;
};

export const isPrivateNetworkHost = (host: string): boolean => {
  const normalized = normalizeHostname(host);
  if (
    normalized === '::' ||
    isLocalLoopbackHost(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === 'home.arpa' ||
    normalized.endsWith('.home.arpa') ||
    (!normalized.includes('.') && !normalized.includes(':'))
  ) {
    return true;
  }
  if (normalized.endsWith('.ts.net')) return true;
  const parts = parseIpv4Address(normalized) ?? parseIpv4MappedIpv6Address(normalized);
  if (parts) return isPrivateIpv4Address(parts);
  const firstIpv6Token = normalized.split(':', 1)[0] ?? '';
  if (!normalized.includes(':') || !/^[\da-f]{1,4}$/u.test(firstIpv6Token)) return false;
  const firstIpv6Hextet = Number.parseInt(firstIpv6Token, 16);
  return (
    Number.isInteger(firstIpv6Hextet) &&
    ((firstIpv6Hextet & 0xfe00) === 0xfc00 || (firstIpv6Hextet & 0xffc0) === 0xfe80)
  );
};

/** Whether a hostname is eligible to be disclosed to a public favicon provider. */
export const isPublicFaviconHost = (host: string): boolean => {
  if (host.endsWith('..')) return false;
  const normalized = normalizeHostname(host);
  if (isPrivateNetworkHost(normalized)) return false;
  if (
    ['.alt', '.example', '.internal', '.invalid', '.onion', '.test'].some(
      (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix)
    )
  ) {
    return false;
  }
  const ipv4 = parseIpv4Address(normalized) ?? parseIpv4MappedIpv6Address(normalized);
  if (ipv4) return !isSpecialPurposeIpv4Address(ipv4);
  if (!normalized.includes(':')) return true;
  const ipv6 = parseIpv6Address(normalized);
  if (!ipv6) return false;
  if (ipv6PrefixMatches(ipv6, [0x0064, 0xff9b, 0, 0, 0, 0, 0, 0], 96)) {
    const embeddedIpv4 = [ipv6[6]! >>> 8, ipv6[6]! & 0xff, ipv6[7]! >>> 8, ipv6[7]! & 0xff];
    return !isSpecialPurposeIpv4Address(embeddedIpv4);
  }
  const first = ipv6[0]!;
  if ((first & 0xe000) !== 0x2000) return false;
  if (ipv6PrefixMatches(ipv6, [0x2001, 0, 0, 0, 0, 0, 0, 0], 23)) {
    const publicProtocolAssignment =
      (ipv6[1] === 1 &&
        ipv6.slice(2, 7).every((part) => part === 0) &&
        [1, 2, 3].includes(ipv6[7]!)) ||
      ipv6PrefixMatches(ipv6, [0x2001, 3, 0, 0, 0, 0, 0, 0], 32) ||
      ipv6PrefixMatches(ipv6, [0x2001, 4, 0x0112, 0, 0, 0, 0, 0], 48) ||
      ipv6PrefixMatches(ipv6, [0x2001, 0x20, 0, 0, 0, 0, 0, 0], 28) ||
      ipv6PrefixMatches(ipv6, [0x2001, 0x30, 0, 0, 0, 0, 0, 0], 28);
    return publicProtocolAssignment;
  }
  if (ipv6PrefixMatches(ipv6, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32)) return false;
  if (ipv6PrefixMatches(ipv6, [0x2002, 0, 0, 0, 0, 0, 0, 0], 16)) return false;
  if (first === 0x3fff && (ipv6[1]! & 0xf000) === 0) return false;
  return true;
};

/** Return a public favicon URL without disclosing private or reserved hosts. */
export function faviconUrlForOrigin(rawUrl: string | null | undefined, size = 32): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!url.host) return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isPublicFaviconHost(url.hostname)) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.host)}&sz=${size}`;
  } catch {
    return null;
  }
}

/** Parses external http/https URL, returning host information if valid. */
export function parseExternalMarkdownUrl(
  href: string | null | undefined
): { url: URL; host: string; hostname: string } | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return { url, host: url.host, hostname: url.hostname };
  } catch {
    return null;
  }
}

export function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}
