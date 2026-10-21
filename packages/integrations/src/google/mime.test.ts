import { describe, expect, it } from "vitest";
import { buildRawMessage, extractPlainTextBody, getHeader } from "./mime.js";

describe("buildRawMessage", () => {
  it("produces a base64url string decoding back to a valid RFC2822 message", () => {
    const raw = buildRawMessage({ to: "a@example.com", subject: "Hi there", body: "Hello world" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Hi there");
    expect(decoded).toContain("Hello world");
  });
});

describe("extractPlainTextBody", () => {
  it("decodes a simple text/plain body", () => {
    const body = Buffer.from("plain text body").toString("base64url");
    const result = extractPlainTextBody({ mimeType: "text/plain", body: { data: body } });
    expect(result).toBe("plain text body");
  });

  it("finds text/plain inside a multipart payload", () => {
    const body = Buffer.from("the actual text").toString("base64url");
    const result = extractPlainTextBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: Buffer.from("<p>html</p>").toString("base64url") } },
        { mimeType: "text/plain", body: { data: body } },
      ],
    });
    expect(result).toBe("the actual text");
  });

  it("returns an empty string for an undefined payload", () => {
    expect(extractPlainTextBody(undefined)).toBe("");
  });
});

describe("getHeader", () => {
  it("is case-insensitive", () => {
    const headers = [{ name: "Subject", value: "Hello" }];
    expect(getHeader(headers, "subject")).toBe("Hello");
  });

  it("returns an empty string when missing", () => {
    expect(getHeader([], "Subject")).toBe("");
    expect(getHeader(undefined, "Subject")).toBe("");
  });
});
