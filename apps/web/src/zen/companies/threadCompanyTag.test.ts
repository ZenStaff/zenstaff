import type { EnvironmentId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readProject } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { THREAD_CREATE_COMMAND_LABEL, THREAD_START_TURN_COMMAND_LABEL } from "./companiesModel";
import { companyAssignThread, useSelectedCompanyStore } from "./companiesState";
import { zenTagNewThreadCompany } from "./threadCompanyTag";

vi.mock("@t3tools/client-runtime/state/runtime", { spy: true });
vi.mock("../../state/entities", { spy: true });

const REMOTE = "env-remote-1" as EnvironmentId;
const firstTurn = (projectId: string) => ({
  environmentId: REMOTE,
  input: {
    threadId: "thread-pos",
    message: { text: "uite cum se vede pe un ecran mic de pos" },
    bootstrap: { createThread: { projectId } },
  },
});

describe("thread-creating command labels", () => {
  // The hook recognises them by label; an upstream rename must fail here.
  it("match upstream's thread commands", () => {
    expect(threadEnvironment.create.label).toBe(THREAD_CREATE_COMMAND_LABEL);
    expect(threadEnvironment.startTurn.label).toBe(THREAD_START_TURN_COMMAND_LABEL);
  });
});

describe("zenTagNewThreadCompany", () => {
  beforeEach(() => {
    vi.mocked(runAtomCommand).mockReset();
    vi.mocked(runAtomCommand).mockResolvedValue(AsyncResult.success({}) as never);
    vi.mocked(readProject).mockImplementation(
      (ref) =>
        ({
          id: ref.projectId,
          environmentId: ref.environmentId,
          ...(ref.projectId === "scratch" ? { isScratch: true } : {}),
        }) as never,
    );
  });

  it("tags a No project chat on its own (remote) machine with the chosen company", async () => {
    useSelectedCompanyStore.getState().setSelectedCompanyId("horecaos");
    await zenTagNewThreadCompany(THREAD_START_TURN_COMMAND_LABEL, firstTurn("scratch"));
    expect(runAtomCommand).toHaveBeenCalledTimes(1);
    const [, command, value] = vi.mocked(runAtomCommand).mock.calls[0]!;
    expect(command).toBe(companyAssignThread);
    expect(value).toEqual({
      environmentId: REMOTE,
      input: { threadId: "thread-pos", companyId: "horecaos" },
    });
  });

  it("does nothing on Personal, for all companies, in a real project or for later turns", async () => {
    useSelectedCompanyStore.getState().setSelectedCompanyId("personal");
    await zenTagNewThreadCompany(THREAD_START_TURN_COMMAND_LABEL, firstTurn("scratch"));
    useSelectedCompanyStore.getState().setSelectedCompanyId(null);
    await zenTagNewThreadCompany(THREAD_START_TURN_COMMAND_LABEL, firstTurn("scratch"));
    useSelectedCompanyStore.getState().setSelectedCompanyId("horecaos");
    await zenTagNewThreadCompany(THREAD_START_TURN_COMMAND_LABEL, firstTurn("pos-app"));
    await zenTagNewThreadCompany(THREAD_START_TURN_COMMAND_LABEL, {
      environmentId: REMOTE,
      input: { threadId: "thread-pos", message: { text: "again" } },
    });
    expect(runAtomCommand).not.toHaveBeenCalled();
  });
});
