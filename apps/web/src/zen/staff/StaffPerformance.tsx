// Zen Staff AI staff: "Performanță", the old Evaluation and Quality tabs in one place. This month's
// numbers per AI employee (with proposed instruction updates), then three tools to check work
// before it leaves the company, one at a time, each with a plain explanation.
import { CalculatorIcon, FileSearchIcon, UsersRoundIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useZenText } from "../i18n/zenI18n";
import { SectionHeading } from "../ui/Registru";
import { staffHomeText } from "./staffHome.i18n";
import { StaffEvaluationTab, StaffQualityTab, type StaffQualityTool } from "./StaffInsights";
import type { StaffContext } from "./staffShared";

const TOOLS: ReadonlyArray<{ readonly id: StaffQualityTool; readonly icon: LucideIcon }> = [
  { id: "checker", icon: FileSearchIcon },
  { id: "estimate", icon: CalculatorIcon },
  { id: "panel", icon: UsersRoundIcon },
];

export function StaffPerformanceTab(props: { readonly context: StaffContext }) {
  const h = useZenText(staffHomeText);
  const [tool, setTool] = useState<StaffQualityTool>("checker");
  const label = {
    checker: [h.toolChecker, h.toolCheckerHelp],
    estimate: [h.toolEstimate, h.toolEstimateHelp],
    panel: [h.toolPanel, h.toolPanelHelp],
  } as const;
  return (
    <div className="flex flex-col gap-12">
      <p className="zr-soft max-w-3xl">{h.performanceIntro}</p>
      <section className="flex flex-col gap-5">
        <SectionHeading title={h.monthTitle} />
        <StaffEvaluationTab context={props.context} />
      </section>
      <section className="flex flex-col gap-5">
        <SectionHeading title={h.toolsTitle} />
        <div className="grid gap-3 md:grid-cols-3" role="tablist" aria-label={h.toolsTitle}>
          {TOOLS.map((item) => {
            const Icon = item.icon;
            const [title, help] = label[item.id];
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tool === item.id}
                onClick={() => setTool(item.id)}
                className={cn(
                  "zr-card flex items-start gap-3 p-4 text-left transition-colors",
                  tool === item.id ? "border-zr-ink! ring-1 ring-zr-ink" : "zr-card-hover",
                )}
                data-staff-tool={item.id}
              >
                <span className="zr-tint flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">{title}</span>
                  <span className="zr-muted text-sm leading-snug">{help}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="zr-card p-5" role="tabpanel">
          <StaffQualityTab key={tool} context={props.context} tool={tool} />
        </div>
      </section>
    </div>
  );
}
