import type { ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";

/** An icon button with a tooltip, for the editors' toolbars. */
export function EditorToolButton(props: {
  readonly label: string;
  readonly active?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant={props.active === true ? "secondary" : "ghost"}
            aria-label={props.label}
            aria-pressed={props.active}
            onClick={props.onPress}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}
