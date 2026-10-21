import { describe, expect, it } from "vitest";
import { buildGoogleAuthUrl, GOOGLE_SCOPES } from "./oauth.js";

const config = { clientId: "test-client-id", clientSecret: "test-secret", redirectUri: "http://localhost:4100/api/v1/integrations/google/callback" };

describe("buildGoogleAuthUrl", () => {
  it("includes offline access, forced consent, all scopes, and the state param", () => {
    const url = new URL(buildGoogleAuthUrl(config, "my-state-value"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("my-state-value");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    const grantedScopes = url.searchParams.get("scope")!.split(" ");
    for (const scope of GOOGLE_SCOPES) {
      expect(grantedScopes).toContain(scope);
    }
  });
});
