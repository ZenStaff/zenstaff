// Hub v9: the company's roles in the app (Team > company > Roluri). Owners and admins edit the
// permission grid of Membru, Invitat and the custom roles, create and delete custom roles, and give
// one to each member or guest. Roles for one project or team stay in the web dashboard (/app/roluri).
// Everything is checked again on the hub; this page only shows what the hub allows.
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZenHubRolesList } from "@t3tools/contracts/zenHub";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastManager } from "../../components/ui/toast";
import { useZenText } from "../i18n/zenI18n";
import { hubErrorMessage, useHubQuery, type HubCall } from "./hubClient";
import { securityText } from "./security.i18n";
import { ZenNativeSelect } from "../ui/ZenSelect";
import { Checkbox } from "../../components/ui/checkbox";

type Role = ZenHubRolesList["roles"][number];

/** The grid's checked permissions after one toggle (pure, tested). */
export function togglePermission(
  current: ReadonlyArray<string>,
  permission: string,
  on: boolean,
): Array<string> {
  const next = new Set(current);
  if (on) next.add(permission);
  else next.delete(permission);
  return [...next].toSorted();
}

function PermissionGrid(props: {
  readonly catalog: ZenHubRolesList["catalog"];
  readonly value: ReadonlyArray<string>;
  readonly editable: boolean;
  readonly onChange: (next: Array<string>) => void;
}) {
  const t = useZenText(securityText);
  const checked = new Set(props.value);
  const box = (permission: string, label: string) => (
    <Checkbox
      aria-label={label}
      checked={checked.has(permission)}
      disabled={!props.editable}
      onCheckedChange={(on) =>
        props.onChange(togglePermission(props.value, permission, on === true))
      }
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="permission-grid">
          <thead>
            <tr>
              <th />
              {props.catalog.actions.map((action) => (
                <th
                  key={action}
                  className="px-1 py-1 text-center font-medium text-muted-foreground text-xs"
                >
                  {t.actions[action] ?? action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.catalog.resources.map((resource) => (
              <tr key={resource} className="border-t">
                <th className="py-1.5 pr-2 text-left font-medium">
                  {t.resources[resource] ?? resource}
                </th>
                {props.catalog.actions.map((action) => (
                  <td key={action} className="text-center">
                    {box(
                      `${resource}:${action}`,
                      `${t.resources[resource] ?? resource}: ${t.actions[action] ?? action}`,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.catalog.extras.map((permission) => (
        <label key={permission} className="flex items-start gap-2 text-sm">
          {box(permission, t.extras[permission] ?? permission)}
          <span>{t.extras[permission] ?? permission}</span>
        </label>
      ))}
    </div>
  );
}

export function CompanyRoles(props: {
  readonly companyId: string;
  readonly environmentId: EnvironmentId;
  readonly call: HubCall;
  readonly hubUrl: string | null;
  readonly roleLabel: (role: string) => string;
}) {
  const t = useZenText(securityText);
  const { data, refresh } = useHubQuery<ZenHubRolesList>(props.environmentId, "roles.list", {
    companyId: props.companyId,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReadonlyArray<string> | null>(null);
  const [newName, setNewName] = useState("");
  if (data === null) return null;
  const role: Role | undefined = data.roles.find(
    (item) => item.id === (selected ?? data.roles.find((r) => r.custom)?.id ?? "member"),
  );
  const fixed = role?.builtin === "owner" || role?.builtin === "admin";
  const permissions = draft ?? role?.permissions ?? [];
  const run = async (title: string, work: () => Promise<unknown>) => {
    try {
      await work();
      setDraft(null);
      refresh();
    } catch (cause) {
      toastManager.add({ type: "error", title, description: hubErrorMessage(cause) });
    }
  };
  const customRoles = data.roles.filter((item) => item.custom);
  return (
    <div className="flex flex-col gap-4" data-testid="company-roles">
      <p className="text-muted-foreground text-sm">{t.rolesHint}</p>
      <div className="flex flex-wrap gap-2">
        {data.roles.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={item.id === role?.id ? "default" : "outline"}
            onClick={() => {
              setSelected(item.id);
              setDraft(null);
            }}
          >
            {item.builtin ? props.roleLabel(item.builtin) : item.name}
            <Badge variant="outline" className="ml-1">
              {t.people(item.memberCount)}
            </Badge>
          </Button>
        ))}
      </div>
      {role !== undefined ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {role.builtin ? props.roleLabel(role.builtin) : role.name}
            </span>
            {role.custom ? null : <Badge variant="outline">{t.builtinRole}</Badge>}
            {role.description ? (
              <span className="text-muted-foreground text-sm">{role.description}</span>
            ) : null}
          </div>
          {fixed ? <p className="text-muted-foreground text-sm">{t.allPermissions}</p> : null}
          <PermissionGrid
            catalog={data.catalog}
            value={
              fixed
                ? [
                    ...data.catalog.resources.flatMap((r) =>
                      data.catalog.actions.map((a) => `${r}:${a}`),
                    ),
                    ...data.catalog.extras,
                  ]
                : permissions
            }
            editable={data.canEdit && !fixed}
            onChange={setDraft}
          />
          {data.canEdit && !fixed ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={draft === null}
                onClick={() =>
                  void run(t.couldNotSave, () =>
                    props.call("roles.save", {
                      companyId: props.companyId,
                      roleId: role.id,
                      permissions,
                    }),
                  )
                }
              >
                {t.save}
              </Button>
              <Button
                size="sm"
                variant="ghost-destructive"
                onClick={() =>
                  void run(t.couldNotSave, async () => {
                    await props.call("roles.delete", {
                      companyId: props.companyId,
                      roleId: role.id,
                    });
                    setSelected(null);
                  })
                }
              >
                {role.custom ? t.deleteRole : t.resetRole}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {data.canEdit ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t.couldNotSave, async () => {
              const created = await props.call<{ id: string }>("roles.save", {
                companyId: props.companyId,
                name: newName.trim(),
                permissions: ["chats:vede"],
              });
              setNewName("");
              setSelected(created.id);
            });
          }}
        >
          <Input
            aria-label={t.newRoleName}
            placeholder={t.newRole}
            className="max-w-56"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={newName.trim() === ""}>
            {t.create}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">{t.onlyManagers}</p>
      )}
      <ul className="flex flex-col divide-y text-sm" data-testid="role-assignments">
        {data.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2 py-1.5">
            <span className="flex-1">
              {member.name} <span className="text-muted-foreground">{member.email}</span>
            </span>
            <Badge variant="outline">{props.roleLabel(member.role)}</Badge>
            {member.role === "owner" || member.role === "admin" ? null : data.canEdit ? (
              <ZenNativeSelect
                aria-label={t.customRoleOf(member.name)}
                className="h-7 rounded-md border bg-background px-2 text-xs"
                value={member.customRoleId ?? ""}
                onChange={(event) =>
                  void run(t.couldNotAssign, () =>
                    props.call("member.setAccess", {
                      companyId: props.companyId,
                      userId: member.userId,
                      customRoleId: event.target.value === "" ? null : event.target.value,
                      scoped: member.scoped,
                    }),
                  )
                }
              >
                <option value="">{t.noCustomRole}</option>
                {customRoles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </ZenNativeSelect>
            ) : member.customRoleId !== null ? (
              <Badge>
                {customRoles.find((item) => item.id === member.customRoleId)?.name ?? ""}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">{t.agentsHint}</p>
      {props.hubUrl !== null ? (
        <a
          className="text-sm underline"
          href={`${props.hubUrl.replace(/\/$/, "")}/app/roluri`}
          target="_blank"
          rel="noreferrer"
        >
          {t.openDashboard}
        </a>
      ) : null}
    </div>
  );
}
