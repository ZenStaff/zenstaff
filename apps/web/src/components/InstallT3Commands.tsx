import { ZEN_CLI_INSTALL_PS1_URL, ZEN_CLI_INSTALL_SH_URL } from "@t3tools/contracts/zen";

import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `t3`, then run `command`. Both installers are shown
 * because the browser showing this is often not the computer being set up.
 */
export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* Zen Staff: the one-line installers show only once published (ZEN.md "CLI command"). */}
      {ZEN_CLI_INSTALL_SH_URL !== null && ZEN_CLI_INSTALL_PS1_URL !== null ? (
        <>
          <p className="text-xs text-muted-foreground">macOS, Linux</p>
          <CommandBlock command={`curl -fsSL ${ZEN_CLI_INSTALL_SH_URL} | sh`} />
          <p className="text-xs text-muted-foreground">Windows (PowerShell)</p>
          <CommandBlock command={`irm ${ZEN_CLI_INSTALL_PS1_URL} | iex`} />
          <p className="text-xs text-muted-foreground">Then</p>
        </>
      ) : null}
      <CommandBlock command={command} />
      {ZEN_CLI_INSTALL_SH_URL !== null ? (
        <p className="text-xs text-muted-foreground">
          Skip the install if you already have <code className="font-mono">t3</code>. If{" "}
          <code className="font-mono">t3</code> is not found after installing, add the folder the
          installer names to your PATH.
        </p>
      ) : null}
    </div>
  );
}
