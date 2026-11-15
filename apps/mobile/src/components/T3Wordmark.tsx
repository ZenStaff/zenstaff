import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { ZEN_APP_BASE_NAME, ZEN_MARK_16_PATH } from "@t3tools/contracts/zen";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  // Zen Staff: the "Semnătura" Z mark in place of upstream's T3 wordmark; 10-15 px, so the 16 px
  // hinted drawing (assets/zen/zen-mark-16px.svg) cropped to its stroke, as on the web.
  return (
    <Svg
      accessibilityLabel={ZEN_APP_BASE_NAME}
      height={props.height}
      width={props.height}
      viewBox="2 2 12 12"
    >
      <ThemedPath
        d={ZEN_MARK_16_PATH}
        color={props.color}
        colorClassName={props.colorClassName}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
