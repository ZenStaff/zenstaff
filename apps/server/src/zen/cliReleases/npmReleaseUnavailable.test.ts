// Zen Staff: the server never looks up npm `t3` (T3 Code's package); see ZEN.md "CLI command".
import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import { ZEN_CLI_RELEASES_REPO, ZEN_NPM_RELEASE_UNAVAILABLE_REASON } from "@t3tools/contracts/zen";
import * as Effect from "effect/Effect";

import * as NpmRelease from "../../cloud/npmRelease.ts";

it.effect.each(["latest", "nightly", "0.2.8"])(
  "answers %s with Zen's not-on-npm reason instead of an upstream npm release",
  (spec) =>
    Effect.gen(function* () {
      const npmRelease = yield* NpmRelease.NpmRelease;
      const error = yield* Effect.flip(npmRelease.get({ spec }));
      expect(error).toBeInstanceOf(ServerNpmReleaseError);
      expect(error.reason).toBe(ZEN_NPM_RELEASE_UNAVAILABLE_REASON);
      expect(error.message).toContain(ZEN_CLI_RELEASES_REPO);
    }).pipe(Effect.provide(NpmRelease.layer)),
);
