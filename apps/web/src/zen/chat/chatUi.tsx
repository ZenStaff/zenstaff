// Zen Staff chat integrations: small building blocks shared by the setup page's tabs.
import type { ReactNode } from "react";

import { toastManager } from "../../components/ui/toast";
import { cn } from "../../lib/utils";
import { chatErrorMessage } from "./chatClient";
import { ZenNativeSelect } from "../ui/ZenSelect";

export function Section(props: {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-medium text-sm">
          {props.icon}
          {props.title}
        </h2>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function Field(props: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly htmlFor?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", props.className)}>
      <label className="font-medium text-xs" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
    </div>
  );
}

export function NativeSelect(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <ZenNativeSelect
      id={props.id}
      aria-label={props.label}
      disabled={props.disabled}
      className={cn(
        "h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60",
        props.className,
      )}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.children}
    </ZenNativeSelect>
  );
}

export function Problems(props: { readonly items: ReadonlyArray<string> }) {
  if (props.items.length === 0) return null;
  return (
    <ul role="alert" className="list-disc pl-5 text-destructive-foreground text-xs">
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function notifyError(title: string, cause: unknown) {
  toastManager.add({ type: "error", title, description: chatErrorMessage(cause) });
}

export function notifySuccess(title: string, description?: string) {
  toastManager.add({ type: "success", title, ...(description ? { description } : {}) });
}
