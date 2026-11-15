// Zen Staff: the app's own Select with a native <select>'s small API (value, onChange, options),
// so Office screens never show the operating system's dropdown. Empty values are allowed ("no
// manager"); groups render as labelled sections.
import { Children, Fragment, isValidElement, type ReactNode } from "react";

import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { cn } from "../../lib/utils";

export interface ZenSelectOption {
  readonly value: string;
  readonly label: string;
  /** Options with the same group are listed under that label, in order. */
  readonly group?: string;
}

/** Base UI keeps "" for "nothing chosen"; an empty option gets its own value instead. */
const EMPTY = "__zen-empty__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

export function ZenSelect(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: ReadonlyArray<ZenSelectOption>;
  readonly label?: string;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly size?: "xs" | "sm" | "default";
  /** Width and layout only (the trigger keeps its own look). */
  readonly className?: string;
  readonly placeholder?: string;
  readonly testId?: string;
  /** `data-*` attributes for the trigger (tests and selectors). */
  readonly dataAttributes?: Readonly<Record<string, string | boolean | undefined>>;
}) {
  const current = props.options.find((option) => option.value === props.value);
  const groups: Array<{ readonly group: string | null; readonly options: ZenSelectOption[] }> = [];
  for (const option of props.options) {
    const group = option.group ?? null;
    const last = groups.at(-1);
    if (last && last.group === group) last.options.push(option);
    else groups.push({ group, options: [option] });
  }
  return (
    <span className={cn("inline-flex min-w-0", props.className)}>
      <Select
        value={encode(props.value)}
        disabled={props.disabled}
        onValueChange={(value) => {
          if (typeof value === "string") props.onChange(decode(value));
        }}
      >
        <SelectTrigger
          id={props.id}
          size={props.size ?? "default"}
          className="w-full"
          aria-label={props.label}
          data-testid={props.testId}
          {...props.dataAttributes}
        >
          <SelectValue>{current?.label ?? props.placeholder ?? ""}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          {groups.map((entry) =>
            entry.group === null ? (
              <Fragment key={`plain-${entry.options[0]?.value ?? ""}`}>
                {entry.options.map((option) => (
                  <SelectItem key={option.value} value={encode(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </Fragment>
            ) : (
              <SelectGroup key={`group-${entry.group}`}>
                <SelectGroupLabel>{entry.group}</SelectGroupLabel>
                {entry.options.map((option) => (
                  <SelectItem key={option.value} value={encode(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ),
          )}
        </SelectPopup>
      </Select>
    </span>
  );
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * The options of `<option>` / `<optgroup>` children, for wrappers that kept a native select's
 * children API (their callers stay as they are).
 */
function optionsFromChildren(children: ReactNode, group?: string): ZenSelectOption[] {
  const out: ZenSelectOption[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ value?: unknown; label?: string; children?: ReactNode }>(child)) {
      continue;
    }
    if (child.type === "option") {
      const label = textOf(child.props.children);
      const value = child.props.value === undefined ? label : String(child.props.value);
      out.push(group === undefined ? { value, label } : { value, label, group });
    } else if (child.type === "optgroup") {
      out.push(...optionsFromChildren(child.props.children, child.props.label ?? ""));
    } else if (child.type === Fragment) {
      out.push(...optionsFromChildren(child.props.children, group));
    }
  }
  return out;
}

const LAYOUT_CLASS = /^(?:w-|max-w-|min-w-|flex-|basis-|grow|shrink|self-|sm:w-|md:w-)/;

/**
 * A drop-in for a native `<select>` with `<option>` children and an `onChange(event)` that reads
 * `event.target.value`: same call sites, the app's own Select. Only layout classes are kept.
 */
export function ZenNativeSelect(
  props: {
    readonly value: string | number;
    readonly onChange: (event: {
      readonly target: { readonly value: string };
      readonly currentTarget: { readonly value: string };
    }) => void;
    readonly children: ReactNode;
    readonly className?: string | undefined;
    readonly id?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly "aria-label"?: string | undefined;
  } & { readonly [key: `data-${string}`]: string | boolean | undefined },
) {
  const dataAttributes = Object.fromEntries(
    Object.entries(props).filter(([key]) => key.startsWith("data-")),
  ) as Record<string, string | boolean | undefined>;
  const layout = (props.className ?? "")
    .split(/\s+/)
    .filter((token) => LAYOUT_CLASS.test(token))
    .join(" ");
  return (
    <ZenSelect
      value={String(props.value)}
      onChange={(value) => props.onChange({ target: { value }, currentTarget: { value } })}
      options={optionsFromChildren(props.children)}
      {...(props["aria-label"] === undefined ? {} : { label: props["aria-label"] })}
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      size="sm"
      className={layout}
      dataAttributes={dataAttributes}
    />
  );
}
