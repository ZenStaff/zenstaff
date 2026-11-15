import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

import { ZEN_DESKTOP_RENDERER_ORIGINS } from "./zen.ts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = [
  "t3code://app",
  "t3code-dev://app",
  ...ZEN_DESKTOP_RENDERER_ORIGINS,
] as const;
