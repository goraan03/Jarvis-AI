import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { checkUrlAllowed } from "./ssrfGuard.js";
import type {
  BrowsePageJobData,
  BrowsePageResult,
  DownloadFileJobData,
  DownloadFileResult,
  FillFormJobData,
  FillFormResult,
} from "./types.js";

const MAX_TEXT_LENGTH = 20_000; // chars — bounds what gets fed back to the model
const NAVIGATION_TIMEOUT_MS = 15_000;
const HARD_JOB_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_DOWNLOAD_CONTENT_TYPES = [/^text\//, /^application\/pdf$/, /^application\/json$/, /^image\//];
const MAX_REDIRECTS = 5;

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/**
 * Runs `operation` inside a fresh, isolated browser context (no
 * persistent cookies across unrelated calls — docs/security-model.md
 * §7) with every request the context makes — including redirects and
 * page-initiated fetches, not just the initial navigation — checked
 * against the SSRF guard. A hard timeout force-closes the context,
 * which actually tears down its page/JS execution rather than merely
 * abandoning a promise.
 */
export async function withGuardedContext<T>(
  operation: (page: Page, actions: string[]) => Promise<T>,
  timeoutMs: number = HARD_JOB_TIMEOUT_MS,
): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const actions: string[] = [];

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const result = await checkUrlAllowed(url);
    if (result.blocked) {
      actions.push(`BLOCKED ${url} (${result.reason})`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

  let timer!: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Await the close before rejecting — callers must be able to trust
      // that once this error surfaces, the browser resources are
      // *already* torn down, not just scheduled for teardown.
      context
        .close()
        .catch(() => undefined)
        .finally(() => reject(new Error("Browser task exceeded its execution timeout and was terminated.")));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(page, actions), timeoutPromise]);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
  }
}

export async function runBrowsePage(data: BrowsePageJobData): Promise<BrowsePageResult> {
  const initial = await checkUrlAllowed(data.url);
  if (initial.blocked) {
    throw new Error(`Navigation blocked: ${initial.reason}`);
  }

  return withGuardedContext(async (page, actions) => {
    actions.push(`navigate ${data.url}`);
    await page.goto(data.url, { waitUntil: "domcontentloaded" });
    const finalUrl = page.url();
    const title = await page.title();
    let text = await page.evaluate(() => document.body?.innerText ?? "");
    if (text.length > MAX_TEXT_LENGTH) {
      text = `${text.slice(0, MAX_TEXT_LENGTH)}\n[...truncated...]`;
    }
    actions.push(`extracted ${text.length} chars from ${finalUrl}`);
    return { finalUrl, title, text, actions };
  });
}

export async function runFillForm(data: FillFormJobData): Promise<FillFormResult> {
  const initial = await checkUrlAllowed(data.url);
  if (initial.blocked) {
    throw new Error(`Navigation blocked: ${initial.reason}`);
  }

  return withGuardedContext(async (page, actions) => {
    actions.push(`navigate ${data.url}`);
    await page.goto(data.url, { waitUntil: "domcontentloaded" });

    for (const field of data.fields) {
      await page.fill(field.selector, field.value);
      actions.push(`fill ${field.selector}`);
    }

    if (data.submitSelector) {
      await page.click(data.submitSelector);
      actions.push(`click ${data.submitSelector}`);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }

    return { finalUrl: page.url(), title: await page.title(), actions };
  });
}

async function readWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Download exceeds the maximum allowed size (${maxBytes} bytes).`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Download exceeds the maximum allowed size (${maxBytes} bytes).`);
    }
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Download exceeds the maximum allowed size (${maxBytes} bytes).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Manually follows redirects, re-checking the SSRF guard before every
 * hop — fetch's built-in redirect:'follow' would make the request to
 * each intermediate hop (including a malicious one) before we ever see
 * the final URL, which is too late.
 */
async function guardedFetch(initialUrl: string): Promise<Response> {
  let url = initialUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const check = await checkUrlAllowed(url);
    if (check.blocked) {
      throw new Error(`Download blocked: ${check.reason} (${url})`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects.");
}

export async function runDownloadFile(data: DownloadFileJobData, taskId: string): Promise<DownloadFileResult> {
  const response = await guardedFetch(data.url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!ALLOWED_DOWNLOAD_CONTENT_TYPES.some((re) => re.test(contentType))) {
    throw new Error(`Content type "${contentType}" is not allowed for download.`);
  }

  const buffer = await readWithLimit(response, MAX_DOWNLOAD_BYTES);

  const dir = path.join(os.tmpdir(), "jarvis-browser-downloads", taskId);
  await mkdir(dir, { recursive: true });
  const filename = path.basename(new URL(response.url).pathname) || "download";
  const filePath = path.join(dir, filename);
  await writeFile(filePath, buffer);

  return { filename, sizeBytes: buffer.length, contentType, path: filePath };
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
