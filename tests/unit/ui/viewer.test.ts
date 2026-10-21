import { describe, expect, it } from "vitest";
import { SIGN_IN_URL, viewerLabel } from "../../../ui/src/lib/api";

// M8: what the header and the You tab call a signed-in member, and where Sign up and Sign in go.
describe("the signed-in member's label", () => {
  it("is their name, else their DID", () => {
    expect(viewerLabel({ displayName: "Ada", did: "did:webvh:Qm1:id.mosaic.social:u:abcdefgh" })).toBe("Ada");
    expect(viewerLabel({ displayName: "  ", did: "did:webvh:Qm1:id.mosaic.social:u:abcdefgh" })).toBe(
      "did:webvh:Qm1:id.mosaic.social:u:abcdefgh",
    );
    expect(viewerLabel({ displayName: null, did: null })).toBe("Signed in");
  });

  it("Sign up and Sign in both start at the River's own sign-in route", () => {
    expect(SIGN_IN_URL).toBe("/api/auth/signin");
  });
});
