import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { OutlineExtractionErrorCode, UrlSnapshot } from "@spark/shared";
import * as cheerio from "cheerio";

const TOTAL_TIMEOUT_MS = 8000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_STYLESHEETS = 3;
const JS_SHELL_MIN_VISIBLE_CHARS = 120;

export class UrlExtractionError extends Error {
  readonly code: OutlineExtractionErrorCode;
  readonly statusCode: number;
  readonly suggestion: string;

  constructor(
    code: OutlineExtractionErrorCode,
    statusCode: number,
    message: string,
    suggestion: string
  ) {
    super(message);
    this.name = "UrlExtractionError";
    this.code = code;
    this.statusCode = statusCode;
    this.suggestion = suggestion;
  }
}

export interface UrlFetchRequest {
  url: string;
  resolvedIp: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBytes: number;
}

export interface UrlFetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export type UrlTransport = (req: UrlFetchRequest) => Promise<UrlFetchResponse>;
export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export interface UrlExtractionResult {
  finalUrl: string;
  snapshot: UrlSnapshot;
  sanitizedContextXml: string;
}

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    value = (value << 8) | num;
  }
  return value >>> 0;
}

function isIpv4InCidr(ipUint32: number, baseIp: string, prefixLen: number): boolean {
  const base = parseIpv4ToUint32(baseIp);
  if (base === null) return false;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) === (base & mask);
}

function parseIpv6ToBigInt(rawIp: string): bigint | null {
  const ip = rawIp.split("%")[0]?.toLowerCase() ?? "";
  if (!ip) return null;

  let working = ip;
  // Convert embedded trailing IPv4 (e.g. ::ffff:127.0.0.1) to two 16-bit hex groups
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const ipv4 = parseIpv4ToUint32(working.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    working = `${working.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColonSplit = working.split("::");
  if (doubleColonSplit.length > 2) return null;

  let groups: string[];
  if (doubleColonSplit.length === 2) {
    const left = doubleColonSplit[0] ? doubleColonSplit[0].split(":") : [];
    const right = doubleColonSplit[1] ? doubleColonSplit[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = working.split(":");
  }

  if (groups.length !== 8) return null;

  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    result = (result << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return result;
}

function isIpv6InCidr(ipBigInt: bigint, baseIp: string, prefixLen: number): boolean {
  const base = parseIpv6ToBigInt(baseIp);
  if (base === null) return false;
  const shift = BigInt(128 - prefixLen);
  return ipBigInt >> shift === base >> shift;
}

export function isBlockedIp(rawIp: string): boolean {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(cleaned);

  if (ipVersion === 4) {
    const v4 = parseIpv4ToUint32(cleaned);
    if (v4 === null) return true;
    return (
      isIpv4InCidr(v4, "127.0.0.0", 8) ||
      isIpv4InCidr(v4, "0.0.0.0", 8) ||
      isIpv4InCidr(v4, "10.0.0.0", 8) ||
      isIpv4InCidr(v4, "100.64.0.0", 10) ||
      isIpv4InCidr(v4, "172.16.0.0", 12) ||
      isIpv4InCidr(v4, "192.168.0.0", 16) ||
      isIpv4InCidr(v4, "169.254.0.0", 16)
    );
  }

  if (ipVersion === 6) {
    const v6 = parseIpv6ToBigInt(cleaned);
    if (v6 === null) return true;
    return (
      isIpv6InCidr(v6, "::", 128) ||
      isIpv6InCidr(v6, "::1", 128) ||
      isIpv6InCidr(v6, "::ffff:0:0", 96) ||
      isIpv6InCidr(v6, "fe80::", 10) ||
      isIpv6InCidr(v6, "fc00::", 7) ||
      isIpv6InCidr(v6, "ff00::", 8)
    );
  }

  return true;
}

export function validatePublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "Please enter a valid http or https URL.",
      "Provide a full public URL starting with https:// or upload a screenshot instead."
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "Only http and https URLs are allowed.",
      "Use a public http:// or https:// website URL, or paste a screenshot."
    );
  }

  if (parsed.username || parsed.password) {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "URLs with embedded credentials are not allowed.",
      "Remove username/password credentials from the URL and try again."
    );
  }

  const allowedPort =
    parsed.port === "" ||
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443");
  if (!allowedPort) {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "Only standard ports 80 and 443 are permitted.",
      "Use a public URL on port 80 or 443, or paste a screenshot instead."
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "Private or loopback URLs cannot be inspected.",
      "Enter a publicly reachable website URL or upload a screenshot instead."
    );
  }

  if (net.isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new UrlExtractionError(
      "URL_INVALID_SSRF",
      422,
      "Private, loopback, or link-local IP addresses are blocked.",
      "Enter a public website URL or upload a screenshot instead."
    );
  }

  return parsed;
}

async function defaultDnsLookup(
  hostname: string
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const clean = hostname.replace(/^\[|\]$/g, "");
  const ipVer = net.isIP(clean);
  if (ipVer === 4 || ipVer === 6) {
    return [{ address: clean, family: ipVer }];
  }
  const results = await dnsLookup(clean, { all: true });
  return results
    .filter(
      (entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6
    )
    .map((entry) => ({ address: entry.address, family: entry.family }));
}

async function resolveAndValidateHostIp(
  hostname: string,
  lookupFn: DnsLookupFn
): Promise<{ address: string; family: 4 | 6 }> {
  let records: Array<{ address: string; family: 4 | 6 }>;
  try {
    records = await lookupFn(hostname);
  } catch {
    throw new UrlExtractionError(
      "URL_FETCH_FAILED",
      502,
      `Could not resolve DNS for ${hostname}.`,
      "Check the URL spelling or paste a screenshot of the website instead."
    );
  }

  if (records.length === 0) {
    throw new UrlExtractionError(
      "URL_FETCH_FAILED",
      502,
      `No DNS records found for ${hostname}.`,
      "Verify the domain exists or paste a screenshot instead."
    );
  }

  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new UrlExtractionError(
        "URL_INVALID_SSRF",
        422,
        "Target domain resolves to a private or reserved network address.",
        "Enter a publicly accessible website URL or upload a screenshot instead."
      );
    }
  }

  const firstRecord = records[0];
  if (!firstRecord) {
    throw new UrlExtractionError(
      "URL_FETCH_FAILED",
      502,
      `No DNS records found for ${hostname}.`,
      "Verify the domain exists or paste a screenshot instead."
    );
  }
  return firstRecord;
}

/**
 * Performs an HTTP/HTTPS GET pinned to the pre-validated IP address so DNS
 * rebinding cannot occur between validation and TCP connection.
 */
export async function defaultPinnedUrlTransport(req: UrlFetchRequest): Promise<UrlFetchResponse> {
  const parsed = new URL(req.url);
  const isHttps = parsed.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise<UrlFetchResponse>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        controller.abort();
        reject(
          new UrlExtractionError(
            "URL_TIMEOUT",
            504,
            "Website inspection timed out after 8 seconds.",
            "The site took too long to respond. Paste a screenshot of the page instead."
          )
        );
      },
      Math.max(100, req.timeoutMs)
    );

    const requestOptions: http.RequestOptions & { servername?: string } = {
      method: "GET",
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      signal: controller.signal,
      headers: {
        "User-Agent": "SparkwebDesignInspector/1.0 (+https://sparkweb.dev)",
        Accept: "text/html,application/xhtml+xml,text/css;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
      },
      lookup: ((
        _hostname: string,
        options: unknown,
        callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void
      ) => {
        const wantsAll =
          typeof options === "object" &&
          options !== null &&
          "all" in options &&
          Boolean((options as { all?: boolean }).all);
        if (wantsAll) {
          callback(null, [{ address: req.resolvedIp, family: req.family }]);
          return;
        }
        callback(null, req.resolvedIp, req.family);
      }) as http.RequestOptions["lookup"],
    };

    if (isHttps && net.isIP(parsed.hostname.replace(/^\[|\]$/g, "")) === 0) {
      requestOptions.servername = parsed.hostname;
    }

    const clientReq = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on("data", (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > req.maxBytes) {
          controller.abort();
          clearTimeout(timer);
          reject(
            new UrlExtractionError(
              "URL_TOO_LARGE",
              422,
              "Website response exceeded the 2 MB inspection cap.",
              "Try a lighter page or paste a screenshot of the section you want to build."
            )
          );
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        clearTimeout(timer);
        const normalizedHeaders: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: normalizedHeaders,
          body: Buffer.concat(chunks),
        });
      });

      res.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    clientReq.on("error", (err) => {
      clearTimeout(timer);
      if (err instanceof UrlExtractionError) {
        reject(err);
        return;
      }
      if ((err as { name?: string }).name === "AbortError") {
        reject(
          new UrlExtractionError(
            "URL_TIMEOUT",
            504,
            "Website inspection timed out after 8 seconds.",
            "Paste a screenshot of the target website instead."
          )
        );
        return;
      }
      reject(
        new UrlExtractionError(
          "URL_FETCH_FAILED",
          502,
          `Unable to connect to ${parsed.hostname}.`,
          "Verify the website is publicly reachable or paste a screenshot instead."
        )
      );
    });

    clientReq.end();
  });
}

async function fetchWithRedirects(params: {
  initialUrl: string;
  deadline: number;
  remainingBytes: number;
  transport: UrlTransport;
  dnsLookupFn: DnsLookupFn;
}): Promise<{ finalUrl: string; response: UrlFetchResponse; bytesUsed: number }> {
  let currentUrl = params.initialUrl;
  let bytesUsed = 0;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const remainingMs = params.deadline - Date.now();
    if (remainingMs <= 0) {
      throw new UrlExtractionError(
        "URL_TIMEOUT",
        504,
        "Website inspection timed out after 8 seconds.",
        "Paste a screenshot of the page instead."
      );
    }

    const parsed = validatePublicHttpUrl(currentUrl);
    const resolved = await resolveAndValidateHostIp(parsed.hostname, params.dnsLookupFn);

    const response = await params.transport({
      url: parsed.toString(),
      resolvedIp: resolved.address,
      family: resolved.family,
      timeoutMs: remainingMs,
      maxBytes: Math.max(1, params.remainingBytes - bytesUsed),
    });

    bytesUsed += response.body.byteLength;

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.location;
      if (!location) {
        throw new UrlExtractionError(
          "URL_FETCH_FAILED",
          502,
          "Website returned an invalid redirect response.",
          "Paste a screenshot of the target page instead."
        );
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw new UrlExtractionError(
          "URL_FETCH_FAILED",
          422,
          "Website exceeded the maximum of 5 redirects.",
          "Use the final destination URL or paste a screenshot instead."
        );
      }
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    return {
      finalUrl: parsed.toString(),
      response,
      bytesUsed,
    };
  }

  throw new UrlExtractionError(
    "URL_FETCH_FAILED",
    422,
    "Website exceeded the maximum of 5 redirects.",
    "Use the final destination URL or paste a screenshot instead."
  );
}

function escapeXmlAttributeOrText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeColorToken(raw: string): string | null {
  const hexMatch = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch?.[1]) {
    if (hexMatch[1].length === 3) {
      const [r, g, b] = hexMatch[1].split("");
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return `#${hexMatch[1]}`.toUpperCase();
  }
  return null;
}

function extractColorsFromCss(cssSources: string[]): string[] {
  const seen = new Set<string>();
  const hexRegex = /#[0-9a-fA-F]{3,6}\b/g;
  const rgbRegex = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/gi;

  for (const css of cssSources) {
    for (const match of css.matchAll(hexRegex)) {
      const normalized = normalizeColorToken(match[0]);
      if (normalized) {
        seen.add(normalized);
        if (seen.size >= 16) return Array.from(seen);
      }
    }
    for (const match of css.matchAll(rgbRegex)) {
      const r = Math.min(255, Number(match[1]));
      const g = Math.min(255, Number(match[2]));
      const b = Math.min(255, Number(match[3]));
      const hex =
        `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
      seen.add(hex);
      if (seen.size >= 16) return Array.from(seen);
    }
  }

  return Array.from(seen);
}

const GENERIC_FONT_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "inherit",
  "initial",
  "unset",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

function extractFontsFromCssAndLinks(cssSources: string[], stylesheetHrefs: string[]): string[] {
  const seen = new Set<string>();

  for (const href of stylesheetHrefs) {
    try {
      const parsed = new URL(href);
      if (parsed.hostname.includes("fonts.googleapis.com")) {
        const familyParams = parsed.searchParams.getAll("family");
        for (const fam of familyParams) {
          const cleanName = fam.split(":")[0]?.replace(/\+/g, " ").trim();
          if (cleanName && !GENERIC_FONT_FAMILIES.has(cleanName.toLowerCase())) {
            seen.add(cleanName);
            if (seen.size >= 8) return Array.from(seen);
          }
        }
      }
    } catch {
      // Ignore malformed font link
    }
  }

  const fontRegex = /font-family\s*:\s*([^;}{]+)/gi;
  for (const css of cssSources) {
    for (const match of css.matchAll(fontRegex)) {
      const rawList = match[1] ?? "";
      for (const candidate of rawList.split(",")) {
        const clean = candidate.replace(/["']/g, "").trim();
        if (
          clean &&
          clean.length <= 60 &&
          !clean.startsWith("var(") &&
          !GENERIC_FONT_FAMILIES.has(clean.toLowerCase())
        ) {
          seen.add(clean);
          if (seen.size >= 8) return Array.from(seen);
        }
      }
    }
  }

  return Array.from(seen);
}

export async function extractDesignFromUrl(
  rawUrl: string,
  options?: {
    transport?: UrlTransport;
    dnsLookup?: DnsLookupFn;
  }
): Promise<UrlExtractionResult> {
  const transport = options?.transport ?? defaultPinnedUrlTransport;
  const dnsLookupFn = options?.dnsLookup ?? defaultDnsLookup;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  const { finalUrl, response, bytesUsed } = await fetchWithRedirects({
    initialUrl: rawUrl,
    deadline,
    remainingBytes: MAX_TOTAL_BYTES,
    transport,
    dnsLookupFn,
  });

  if (response.status === 403 || response.status === 429) {
    throw new UrlExtractionError(
      "URL_BLOCKED",
      502,
      `The website blocked automated inspection (HTTP ${response.status}).`,
      "Take or paste a screenshot of the page in the prompt composer instead."
    );
  }

  if (response.status < 200 || response.status >= 400) {
    throw new UrlExtractionError(
      "URL_FETCH_FAILED",
      502,
      `Website returned HTTP ${response.status}.`,
      "Verify the page loads publicly or paste a screenshot instead."
    );
  }

  const rawContentType = (response.headers["content-type"] ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (rawContentType !== "text/html" && rawContentType !== "application/xhtml+xml") {
    throw new UrlExtractionError(
      "URL_INVALID_MIME",
      422,
      `Unsupported content type "${rawContentType || "unknown"}". Expected an HTML webpage.`,
      "Provide a public HTML webpage URL or upload an image file directly."
    );
  }

  const html = response.body.toString("utf-8");
  const $ = cheerio.load(html);

  const hadScriptTags = $("script").length > 0;
  const stylesheetHrefs: string[] = [];
  $('link[rel~="stylesheet"][href]').each((_i, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;
    try {
      const resolvedHref = new URL(href, finalUrl).toString();
      stylesheetHrefs.push(resolvedHref);
    } catch {
      // Ignore malformed href
    }
  });

  const inlineStyleBlocks: string[] = [];
  $("style").each((_i, el) => {
    inlineStyleBlocks.push($(el).text());
  });
  $("[style]").each((_i, el) => {
    const inlineAttr = $(el).attr("style");
    if (inlineAttr) inlineStyleBlocks.push(inlineAttr);
  });

  // Remove executable, hidden, and comment nodes before visible text & landmark analysis
  $("script, noscript, style, template").remove();
  $("[hidden]").remove();
  $("[style]").each((_i, el) => {
    const styleVal = ($(el).attr("style") ?? "").toLowerCase().replace(/\s+/g, "");
    if (styleVal.includes("display:none") || styleVal.includes("visibility:hidden")) {
      $(el).remove();
    }
  });

  // Strip HTML comments recursively
  $("*")
    .contents()
    .filter((_i, node) => node.type === "comment")
    .remove();
  $.root()
    .contents()
    .filter((_i, node) => node.type === "comment")
    .remove();

  const bodyVisibleText = $("body").text().replace(/\s+/g, " ").trim();
  const rootMountNode = $("#root, #app, #__next, [data-reactroot]").first();
  const rootMountText = rootMountNode.length
    ? rootMountNode.text().replace(/\s+/g, " ").trim()
    : bodyVisibleText;

  if (
    (rootMountNode.length > 0 &&
      rootMountText.length < JS_SHELL_MIN_VISIBLE_CHARS &&
      bodyVisibleText.length < JS_SHELL_MIN_VISIBLE_CHARS) ||
    (hadScriptTags && bodyVisibleText.length < JS_SHELL_MIN_VISIBLE_CHARS)
  ) {
    throw new UrlExtractionError(
      "URL_JS_SHELL",
      422,
      "This page appears to be an empty JavaScript-rendered shell with under 120 characters of static content.",
      "Take a screenshot of the rendered page in your browser and paste it here instead."
    );
  }

  // Fetch up to 3 external stylesheets within remaining time & byte budgets
  const fetchedStylesheets: string[] = [];
  let totalBytes = bytesUsed;
  const candidateStylesheets = stylesheetHrefs
    .filter((href) => !href.includes("fonts.googleapis.com"))
    .slice(0, MAX_STYLESHEETS);

  for (const cssUrl of candidateStylesheets) {
    if (Date.now() >= deadline || totalBytes >= MAX_TOTAL_BYTES) {
      break;
    }
    try {
      const cssFetch = await fetchWithRedirects({
        initialUrl: cssUrl,
        deadline,
        remainingBytes: MAX_TOTAL_BYTES - totalBytes,
        transport,
        dnsLookupFn,
      });
      totalBytes += cssFetch.bytesUsed;
      if (cssFetch.response.status >= 200 && cssFetch.response.status < 300) {
        const cssMime = (cssFetch.response.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase();
        if (!cssMime || cssMime === "text/css" || cssMime === "text/plain") {
          fetchedStylesheets.push(cssFetch.response.body.toString("utf-8"));
        }
      }
    } catch (cssErr) {
      if (
        cssErr instanceof UrlExtractionError &&
        (cssErr.code === "URL_TIMEOUT" || cssErr.code === "URL_TOO_LARGE")
      ) {
        throw cssErr;
      }
      // Skip individual failing/blocked CDN stylesheets so valid HTML still extracts
    }
  }

  const allCss = [...inlineStyleBlocks, ...fetchedStylesheets];
  const title =
    $("title").first().text().replace(/\s+/g, " ").trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    new URL(finalUrl).hostname;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    undefined;
  const headings = $("h1, h2, h3, h4")
    .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, 20);
  const landmarkCount = $("header, nav, main, section, article, aside, footer").length;
  const colors = extractColorsFromCss(allCss);
  const fonts = extractFontsFromCssAndLinks(allCss, stylesheetHrefs);

  const snapshot: UrlSnapshot = {
    title,
    ...(description ? { description } : {}),
    headings,
    colors,
    fonts,
    landmarkCount,
  };

  const landmarkTags = $("header, nav, main, section, article, aside, footer")
    .map((_i, el) => {
      const tag = "tagName" in el ? el.tagName : "section";
      const heading = $(el).find("h1, h2, h3").first().text().replace(/\s+/g, " ").trim();
      return heading ? `${tag}: ${heading.slice(0, 100)}` : tag;
    })
    .get()
    .slice(0, 15);

  const sanitizedContextXml = [
    `<untrusted-website-reference url="${escapeXmlAttributeOrText(finalUrl)}">`,
    `  <title>${escapeXmlAttributeOrText(title)}</title>`,
    description
      ? `  <description>${escapeXmlAttributeOrText(description.slice(0, 300))}</description>`
      : null,
    `  <colors>${escapeXmlAttributeOrText(colors.join(", "))}</colors>`,
    `  <fonts>${escapeXmlAttributeOrText(fonts.join(", "))}</fonts>`,
    `  <headings>${escapeXmlAttributeOrText(headings.join(" | "))}</headings>`,
    `  <landmarks>${escapeXmlAttributeOrText(landmarkTags.join(" | "))}</landmarks>`,
    `  <excerpt>${escapeXmlAttributeOrText(bodyVisibleText.slice(0, 2500))}</excerpt>`,
    `</untrusted-website-reference>`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    finalUrl,
    snapshot,
    sanitizedContextXml,
  };
}
