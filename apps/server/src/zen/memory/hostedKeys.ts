// Hosted company memory (hub v13): a company linked to a hub company whose memory is the hosted one
// gets this machine's own memory key from the hub, once, and again when the memory answers that the
// key is revoked or replaced. Pure of services so it is tested on its own (memory.test.ts).
import type { HostedMemoryStatus } from "../hub/hubBridge.ts";

export interface HostedKeysDeps {
  /** The hub's hosted-memory status of the linked hub company, or null. */
  readonly hosted: (companyId: string) => HostedMemoryStatus | null;
  /** The company's memory address on this machine (set by the hub for linked companies). */
  readonly url: (companyId: string) => string | null;
  readonly hasKey: (companyId: string) => boolean;
  readonly setKey: (companyId: string, key: string) => void;
  readonly removeKey: (companyId: string) => void;
  /** Asks the hub for this machine's key (undefined: no hub, or an older app bridge). */
  readonly issue:
    | ((companyId: string) => Promise<{ readonly url: string; readonly apiKey: string }>)
    | undefined;
  /** Called after a new key is stored (start sending queued summaries). */
  readonly onKey: (companyId: string) => void;
}

export function makeHostedKeys(deps: HostedKeysDeps) {
  const errors = new Map<string, string>();
  const inFlight = new Map<string, Promise<void>>();

  const isHosted = (companyId: string) => {
    const hosted = deps.hosted(companyId);
    return (
      hosted !== null && hosted.active && hosted.url !== null && deps.url(companyId) === hosted.url
    );
  };

  const ensure = (companyId: string): Promise<void> => {
    const issue = deps.issue;
    if (issue === undefined || !isHosted(companyId) || deps.hasKey(companyId)) {
      return Promise.resolve();
    }
    const running = inFlight.get(companyId);
    if (running !== undefined) return running;
    const job = issue(companyId)
      .then((answer) => {
        if (deps.url(companyId) !== answer.url) {
          throw new Error("The hub gave a key for another memory address.");
        }
        deps.setKey(companyId, answer.apiKey);
        errors.delete(companyId);
        deps.onKey(companyId);
      })
      .catch((error: unknown) => {
        errors.set(
          companyId,
          error instanceof Error ? error.message : "The hub did not give this machine a key.",
        );
      })
      .finally(() => inFlight.delete(companyId));
    inFlight.set(companyId, job);
    return job;
  };

  /** The memory refused this machine's hosted key: drop it and ask the hub again (once). */
  const renew = async (companyId: string): Promise<boolean> => {
    if (!isHosted(companyId)) return false;
    deps.removeKey(companyId);
    await ensure(companyId);
    return deps.hasKey(companyId);
  };

  return {
    isHosted,
    ensure,
    renew,
    /** Why this machine has no hosted key (last hub answer), or null. */
    errorOf: (companyId: string) => errors.get(companyId) ?? null,
  };
}
