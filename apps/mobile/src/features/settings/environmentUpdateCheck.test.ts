import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { environmentReleaseCheckAtom, releaseCheckError } from "./environmentUpdateCheck";

function makeRegistry() {
  const tasks: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      tasks.push(task);
      return () => undefined;
    },
  });
  const flush = () => {
    for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task();
  };
  return { registry, flush };
}

describe("environmentReleaseCheckAtom", () => {
  // Zen Staff: the lookup in upstream's GitHub releases (pingdotgg/t3code) is off
  // (ZEN_MOBILE_SERVER_RELEASE_CHECK), so the check never fetches and never times out.
  it("never looks up upstream's releases", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    using _globals = { [Symbol.dispose]: () => vi.unstubAllGlobals() };
    const { registry, flush } = makeRegistry();
    const atom = environmentReleaseCheckAtom(EnvironmentId.make("env-zen"));
    const unmount = registry.mount(atom);

    registry.set(atom, async () => "0.0.40");
    await vi.waitFor(() => expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
    expect(releaseCheckError(registry.get(atom))).toBeNull();
    unmount();
    flush();
  });
});
