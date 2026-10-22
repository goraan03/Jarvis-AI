import { describe, expect, it, vi } from "vitest";

vi.mock("./clients.js", () => ({
  getGmailClient: vi.fn(),
  getCalendarClient: vi.fn(),
  getDriveClient: vi.fn(),
}));

import { getDriveClient } from "./clients.js";
import { buildGoogleTools } from "./tools.js";

const config = {
  oauth: { clientId: "x", clientSecret: "x", redirectUri: "http://localhost/callback" },
  encryptionMasterKey: Buffer.alloc(32, 1).toString("base64"),
};

function toolByName(name: string) {
  return buildGoogleTools(config).find((t) => t.name === name)!;
}

describe("search_drive_files", () => {
  it("escapes single quotes in the query and returns matching files", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        files: [{ id: "f1", name: "Doc", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-01-01T00:00:00Z" }],
      },
    });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { list } });

    const result = await toolByName("search_drive_files").handler({ query: "o'clock", maxResults: 10 }, { userId: "u1", taskId: "t1" });

    expect(result.files).toEqual([
      { id: "f1", name: "Doc", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-01-01T00:00:00Z" },
    ]);
    expect(list.mock.calls[0][0].q).toContain("o\\'clock");
  });
});

describe("read_drive_file", () => {
  it("exports a Google Doc to plain text", async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: "f1", name: "Doc", mimeType: "application/vnd.google-apps.document" } });
    const exportFn = vi.fn().mockResolvedValue({ data: "doc body text" });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { get, export: exportFn } });

    const result = await toolByName("read_drive_file").handler({ fileId: "f1" }, { userId: "u1", taskId: "t1" });

    expect(result.content).toBe("doc body text");
    expect(result.truncated).toBe(false);
    expect(exportFn).toHaveBeenCalledWith({ fileId: "f1", mimeType: "text/plain" }, { responseType: "text" });
  });

  it("exports a Google Sheet to CSV", async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: "f2", name: "Sheet", mimeType: "application/vnd.google-apps.spreadsheet" } });
    const exportFn = vi.fn().mockResolvedValue({ data: "a,b,c" });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { get, export: exportFn } });

    const result = await toolByName("read_drive_file").handler({ fileId: "f2" }, { userId: "u1", taskId: "t1" });

    expect(result.content).toBe("a,b,c");
    expect(exportFn).toHaveBeenCalledWith({ fileId: "f2", mimeType: "text/csv" }, { responseType: "text" });
  });

  it("reads a plain-text file via alt=media instead of exporting", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "f3", name: "notes.txt", mimeType: "text/plain" } })
      .mockResolvedValueOnce({ data: "raw text content" });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { get } });

    const result = await toolByName("read_drive_file").handler({ fileId: "f3" }, { userId: "u1", taskId: "t1" });

    expect(result.content).toBe("raw text content");
    expect(get).toHaveBeenNthCalledWith(2, { fileId: "f3", alt: "media" }, { responseType: "text" });
  });

  it("rejects a file type it cannot safely read as text (e.g. a binary image)", async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: "f4", name: "photo.png", mimeType: "image/png" } });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { get } });

    await expect(
      toolByName("read_drive_file").handler({ fileId: "f4" }, { userId: "u1", taskId: "t1" }),
    ).rejects.toThrow(/Unsupported Drive file type/);
  });

  it("truncates content over the size cap and flags it as truncated", async () => {
    const longText = "a".repeat(25_000);
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "f5", name: "big.txt", mimeType: "text/plain" } })
      .mockResolvedValueOnce({ data: longText });
    (getDriveClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ files: { get } });

    const result = await toolByName("read_drive_file").handler({ fileId: "f5" }, { userId: "u1", taskId: "t1" });

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(longText.length);
    expect(result.content).toContain("[...truncated...]");
  });
});
