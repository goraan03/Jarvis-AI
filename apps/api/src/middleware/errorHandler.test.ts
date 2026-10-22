import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./errorHandler.js";

function fakeRes() {
  const res: any = { headersSent: false };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("errorHandler", () => {
  it("responds with a generic 500 and never leaks the raw error to the client", () => {
    const req: any = { path: "/api/v1/whatever", method: "GET" };
    const res = fakeRes();
    const err = new Error("some sensitive internal detail: sk-ant-abcdefghijklmnopqrstuvwxyz");

    errorHandler(err, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain("sensitive internal detail");
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("does not try to respond twice if headers were already sent", () => {
    const req: any = { path: "/x", method: "GET" };
    const res = fakeRes();
    res.headersSent = true;

    errorHandler(new Error("boom"), req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalled();
  });
});
