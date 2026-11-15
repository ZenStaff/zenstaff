// Zen Staff mobile: the Zen config baked into this build (`expoConfig.extra.zen`). See config.ts.
import Constants from "expo-constants";

import { readZenMobileExtra, zenAppLinkPrefixes } from "./config";

export const zenMobileRuntime = readZenMobileExtra(Constants.expoConfig?.extra);

export const ZEN_APP_LINK_PREFIXES = zenAppLinkPrefixes(zenMobileRuntime);
