// Zen Staff desktop isolation names (ZED-ZEN fork of T3 Code). See ZEN.md.
import {
  ZEN_APP_BASE_NAME,
  ZEN_APP_SCHEME,
  ZEN_DEFAULT_PORT,
  ZEN_LINUX_WM_CLASS,
} from "@t3tools/contracts/zen";

export {
  applyZenHomeEnv,
  ZEN_APP_BASE_NAME,
  ZEN_HOME_DIR_NAME,
  ZEN_RELEASES_URL,
} from "@t3tools/contracts/zen";
export const ZEN_DEFAULT_BACKEND_PORT = ZEN_DEFAULT_PORT;
export const ZEN_DESKTOP_SCHEME = ZEN_APP_SCHEME;
export const ZEN_DESKTOP_DEVELOPMENT_SCHEME = `${ZEN_APP_SCHEME}-dev`;
// Stable ids and folder names: they must not follow a later rename of the product name.
export const ZEN_APP_USER_MODEL_ID = "ro.zedzen.zenstaff";
export const ZEN_LINUX_DESKTOP_ENTRY_NAMES = {
  development: `${ZEN_LINUX_WM_CLASS}.Development.desktop`,
  production: `${ZEN_LINUX_WM_CLASS}.desktop`,
} as const;
export const ZEN_USER_DATA_NAMES = {
  development: { current: "zenstaff-dev", legacy: "zenstaff-dev-legacy" },
  production: { current: "zenstaff", legacy: "zenstaff-legacy" },
  // Windows profile seed; never T3 Code's, so its safeStorage key is not copied.
  windowsSeed: "zenstaff-seed",
} as const;
// Upstream imports T3 Code v1 profiles here; Zen Staff has none to import.
export const ZEN_LEGACY_PROFILE_NAMES: ReadonlyArray<string> = [];

// Upstream's update feed ships T3 Code releases, which must never replace Zen Staff.
export const ZEN_AUTO_UPDATE_DISABLED_REASON = `Automatic updates are disabled in ${ZEN_APP_BASE_NAME} builds. Install new versions manually.`;
