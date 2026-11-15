// Hub v9 in the app, rendered: the Roles editor (permission grid, custom roles, who holds which)
// for an owner and for a member, and the read-only live view of a task on the company server.
// The hub client is replaced by fixed answers; screenshots go to screens/security/ when
// ZEN_SCREENS is set (see ZEN.md "Enterprise security").
import type { ZenHubRolesList } from "@t3tools/contracts/zenHub";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { setZenLocalePreference } from "../i18n/zenI18n";
import "../../index.css";

const roles: ZenHubRolesList = {
  catalog: {
    resources: ["chats", "memorie", "pachete", "angajati", "facturare", "echipa", "dispozitive"],
    actions: ["vede", "creeaza", "aproba", "trimite", "administreaza"],
    extras: ["chats:urmareste", "chats:urmareste-toate"],
  },
  roles: [
    {
      id: "owner",
      name: "Owner",
      description: "",
      permissions: [],
      builtin: "owner",
      custom: false,
      memberCount: 1,
    },
    {
      id: "admin",
      name: "Admin",
      description: "",
      permissions: [],
      builtin: "admin",
      custom: false,
      memberCount: 0,
    },
    {
      id: "member",
      name: "Membru",
      description: "",
      permissions: [
        "chats:vede",
        "chats:creeaza",
        "chats:trimite",
        "chats:urmareste",
        "angajati:vede",
        "angajati:creeaza",
        "angajati:trimite",
        "echipa:vede",
      ],
      builtin: "member",
      custom: false,
      memberCount: 1,
    },
    {
      id: "guest",
      name: "Invitat",
      description: "",
      permissions: ["chats:vede"],
      builtin: "guest",
      custom: false,
      memberCount: 0,
    },
    {
      id: "role_vanzari",
      name: "Vânzări",
      description: "Sarcini pentru agenți, fără trimis în afară",
      permissions: [
        "angajati:creeaza",
        "angajati:vede",
        "chats:urmareste",
        "chats:vede",
        "echipa:vede",
      ],
      builtin: null,
      custom: true,
      memberCount: 1,
    },
    {
      id: "role_contabilitate",
      name: "Contabilitate",
      description: "Facturi și date de facturare",
      permissions: ["chats:vede", "echipa:vede", "facturare:administreaza", "facturare:vede"],
      builtin: null,
      custom: true,
      memberCount: 1,
    },
  ],
  members: [
    {
      userId: "u1",
      name: "Ana Pop",
      email: "ana@firma.example",
      role: "owner",
      customRoleId: null,
      scoped: [],
    },
    {
      userId: "u2",
      name: "Ion Rusu",
      email: "ion@echipa.example",
      role: "member",
      customRoleId: "role_vanzari",
      scoped: [],
    },
    {
      userId: "u3",
      name: "Nora Ilie",
      email: "nora@echipa.example",
      role: "member",
      customRoleId: "role_contabilitate",
      scoped: [],
    },
    {
      userId: "u4",
      name: "Maria Pop",
      email: "maria@echipa.example",
      role: "member",
      customRoleId: null,
      scoped: [],
    },
  ],
  canEdit: true,
};

const follow = {
  readOnly: true,
  run: { title: "Oferta pentru clientul Casa Verde", status: "running" },
  snapshot: {
    version: "v3",
    title: "Mara: Oferta pentru clientul Casa Verde",
    kind: "company",
    running: true,
    omittedMessageCount: 0,
    messages: [],
    rows: [
      {
        kind: "message",
        id: "m1",
        role: "user",
        text: "Maria Pop (maria@echipa.example):\nPregătește oferta pentru Casa Verde: meniu de prânz pentru 40 de oameni, vineri.",
        createdAt: "2026-11-08T09:00:00.000Z",
        attachments: [],
      },
      {
        kind: "message",
        id: "m2",
        role: "assistant",
        text: "Am citit fișa clientului și meniurile din ultimele 3 luni. Fac oferta pe trei variante (standard, vegetarian, premium) și o salvez ca document. **Nu o trimit:** cine a dat sarcina nu are dreptul „Angajați AI: trimite”, așa că o las ca ciornă.",
        createdAt: "2026-11-08T09:01:00.000Z",
        attachments: [
          {
            id: "a1",
            kind: "file",
            name: "oferta-casa-verde.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: 48_213,
            dataUrl: null,
          },
        ],
      },
    ],
  },
};

let state: { roles: ZenHubRolesList } = { roles };
vi.mock("./hubClient", () => ({
  hubErrorMessage: (error: unknown, fallback = "x") =>
    error instanceof Error ? error.message : fallback,
  useHubQuery: () => ({ data: state.roles, error: null, refresh: () => undefined }),
  useHubCall: () => ({ environmentId: "env", call: async () => follow }),
}));

const { CompanyRoles } = await import("./CompanyRoles");
const { RunnerFollowView } = await import("./RunnerFollowView");
/** Romanian for one test, back to the system language after it. */
const romanian = () => {
  setZenLocalePreference("ro");
  return { [Symbol.dispose]: () => setZenLocalePreference("auto") };
};
const roleLabel = (role: string) =>
  ({ owner: "Owner", admin: "Admin", member: "Membru", guest: "Invitat" })[role] ?? role;

describe("hub v9 screens", () => {
  it("shows the roles editor to an owner: grid, custom roles, who holds which", async () => {
    using _ro = romanian();
    state = { roles };
    await page.viewport(1100, 1300);
    await using _screen = await render(
      <div className="p-6" style={{ maxWidth: 1000 }}>
        <CompanyRoles
          companyId="horeca"
          environmentId={"env" as never}
          call={async () => ({}) as never}
          hubUrl="https://zenhub.zed-zen.com"
          roleLabel={roleLabel}
        />
      </div>,
    );
    await expect.element(page.getByTestId("permission-grid")).toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Angajați AI: Creează" }))
      .toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "Angajați AI: Trimite" }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole("combobox", { name: "Rolul propriu al lui Ion Rusu" }))
      .toBeVisible();
    await page.screenshot({ path: "__screens__/app-roluri-owner.png" });
  });

  it("shows a member the roles read-only, without the editor", async () => {
    using _ro = romanian();
    state = { roles: { ...roles, canEdit: false } };
    await page.viewport(1100, 1100);
    await using _screen = await render(
      <div className="p-6" style={{ maxWidth: 1000 }}>
        <CompanyRoles
          companyId="horeca"
          environmentId={"env" as never}
          call={async () => ({}) as never}
          hubUrl={null}
          roleLabel={roleLabel}
        />
      </div>,
    );
    await expect
      .element(page.getByText("Doar proprietarii și administratorii schimbă rolurile."))
      .toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Facturare: Administrează" }))
      .toBeDisabled();
    expect(
      page.getByRole("combobox", { name: "Rolul propriu al lui Ion Rusu" }).elements(),
    ).toHaveLength(0);
    await page.screenshot({ path: "__screens__/app-roluri-membru.png" });
  });

  it("follows a task on the company server read-only: steps, files, status, no composer", async () => {
    using _ro = romanian();
    await page.viewport(900, 800);
    await using _screen = await render(
      <div className="p-6" style={{ maxWidth: 760 }}>
        <RunnerFollowView companyId="horeca" staffId="s-3f9a1c0d2e4b5a61" runId="run-7c21" />
      </div>,
    );
    await expect
      .element(page.getByText("Pe serverul firmei: Oferta pentru clientul Casa Verde"))
      .toBeVisible();
    await expect.element(page.getByText("Lucrează")).toBeVisible();
    await expect.element(page.getByText(/oferta-casa-verde\.docx/)).toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    await page.screenshot({ path: "__screens__/app-urmareste-live.png" });
  });
});
