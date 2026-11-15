// Zen Staff (ZED-ZEN fork of T3 Code): the single source of the product name and the
// names that keep it from sharing state with an installed T3 Code. See ZEN.md.
// Dependency-free so build scripts and the Expo config can import it directly.
export const ZEN_APP_BASE_NAME = "Zen Staff";
// The visible name of upstream's "T3 Connect" (sign-in, relay, tunnels). See ZEN.md "Rebranding".
export const ZEN_HUB_NAME = "Zen Hub";
/** The hub we host. Pre-filled on the sign-in form; `ZEN_HUB_URL` overrides it (self-host). */
export const ZEN_HUB_DEFAULT_URL = "https://hub.zenstaff.app";
// The CLI command (upstream: `t3`). `zs` since 0.2.8; `zen` and `zenstaff` (the names of
// 0.2.0-0.2.7) stay installed as aliases, so their links and scripts keep working. `t3` is never
// installed. See ZEN.md "CLI command".
export const ZEN_CLI_NAME = "zs";
export const ZEN_CLI_ALIASES: ReadonlyArray<string> = ["zen", "zenstaff"];
/**
 * Where the CLI's one-line installers will live (upstream: https://t3.codes/install.sh and
 * install.ps1). The rebrand codemod rewrites upstream's URLs to these, so the text is ready.
 */
export const ZEN_CLI_INSTALL_SH_TARGET = "https://zenstaff.app/install.sh";
export const ZEN_CLI_INSTALL_PS1_TARGET = "https://zenstaff.app/install.ps1";
/**
 * The published installers, or null: then nothing shows a `curl | sh` / `irm | iex` line (404).
 * Set to the TARGET values (literals; zen tests check they match): the CLI archives are the public
 * ZenStaff/zenstaff releases and scripts/install.* are served there. See ZEN.md "CLI command".
 */
export const ZEN_CLI_INSTALL_SH_URL: string | null = "https://zenstaff.app/install.sh";
export const ZEN_CLI_INSTALL_PS1_URL: string | null = "https://zenstaff.app/install.ps1";
/**
 * GitHub repo whose releases (tag `v<version>`) carry the CLI archives + `SHA256SUMS` in upstream's
 * layout (upstream: pingdotgg/t3code): self-update, SSH host install (shared/cliRelease.ts).
 * scripts/install.* repeat it as a literal. See ZEN.md "CLI command".
 */
export const ZEN_CLI_RELEASES_REPO = "ZenStaff/zenstaff";
/** Why `server.getNpmRelease` finds nothing: Zen Staff is not on npm (npm `t3` is T3 Code). */
export const ZEN_NPM_RELEASE_UNAVAILABLE_REASON = `${ZEN_APP_BASE_NAME} is not published on npm; its server releases are on GitHub (${ZEN_CLI_RELEASES_REPO}).`;
// Packaging names (installers, Linux binary and desktop entry, Windows publisher).
export const ZEN_APP_ID = "ro.zedzen.zenstaff";
export const ZEN_LINUX_EXECUTABLE_NAME = "zenstaff";
// The window's class/app id on Linux: the desktop app calls setDesktopName("<this>.desktop"), so
// the window reports this name and the desktop entry's StartupWMClass must match it.
export const ZEN_LINUX_WM_CLASS = "ro.zedzen.ZenStaff";
export const ZEN_PUBLISHER_NAME = "ZED-ZEN";
// Support (no public issue tracker: the repository is private). The triage playbook sends reports here.
export const ZEN_SUPPORT_EMAIL = "support@zenstaff.app";
export const ZEN_SUPPORT_URL = "https://zenstaff.app/contact.html";
/** Anonymous statistics are opt-in (ZEN.md "Updates and telemetry"): no upstream "we collect" notice. */
export const ZEN_TELEMETRY_OPT_IN = true;
export const ZEN_PROJECT_FILE_NAME = "zen.json";
export const ZEN_HOME_DIR_NAME = ".zen";
// T3 Code defaults to 3773; a distinct default keeps both apps from racing for one port.
export const ZEN_DEFAULT_PORT = 3873;
export const ZEN_APP_SCHEME = "zen";
/**
 * Where the startup recovery's "Open releases" sends people: the product's download page. The
 * future public repository (github.com/ZenStaff/zenstaff, named by the install scripts) does not
 * exist yet, so the app, the packages and the store metadata link the product site instead.
 */
export const ZEN_RELEASES_URL = "https://zenstaff.app/descarca";
/**
 * The product's own page on what stays on the computer and what the hub sees (the landing site's
 * security page), not the agency site's policy. A full Zen Staff privacy policy + DPA page replaces
 * it when it is published.
 */
export const ZEN_PRIVACY_URL = "https://zenstaff.app/securitate.html";
/** The product page (public; the repository is private, so nothing links to GitHub). */
export const ZEN_PRODUCT_URL = "https://zenstaff.app";
/** Release notes, version by version (the update dialog links here; no GitHub releases). */
export const ZEN_CHANGELOG_URL = "https://zenstaff.app/noutati.html";
/**
 * The fixed download links: they always point at the newest beta build (ZEN.md, "Updates and
 * telemetry", fixed download links). The hub's invitation e-mail carries the same links.
 */
export const ZEN_DOWNLOADS = {
  windows: "https://releases.zed-zen.com/beta/win/Zen-Staff-Setup-x64.exe",
  linuxAppImage: "https://releases.zed-zen.com/beta/linux/Zen-Staff-x86_64.AppImage",
  linuxDeb: "https://releases.zed-zen.com/beta/linux/Zen-Staff-amd64.deb",
} as const;

// The "Semnătura" logo: a Z drawn as one pen stroke whose bottom bar flicks up into a tick.
// Sources: assets/zen/*.svg (rendered by scripts/zen-export-brand-icons.ts). See ZEN.md.
export const ZEN_BRAND_COLORS = {
  navy: "#121A2B",
  vermilion: "#E2401E",
  paper: "#F7F6F2",
} as const;
/** The mark on its 48 grid (stroke 4.5, round caps and joins, translated by 0.85 -0.24). */
export const ZEN_MARK_PATH =
  "M8.5 12.4C17 11.2 28 11.2 37.5 12.2L11 34.6C16.4 34.8 21 35.4 25.6 37L37.8 23";
/** Pixel-hinted drawings, used below 48 px instead of the 48 grid: 16-23 px (16 grid, stroke 2) */
export const ZEN_MARK_16_PATH = "M3.5 4H11.75L3.75 12H10.5L12.75 9";
/** and 24-47 px (32 grid, stroke 3). */
export const ZEN_MARK_32_PATH = "M8 8.5H23.5L8.5 23.5H20L24.75 17.75";
// zen-lockup:begin (generated by build_logo.py's export_app_lockup.py, do not edit by hand)
// Lockup "[Z]en Staff" (variant C), small-size drawing for <= 28 px (assets/zen/zen-lockup-small.svg).
// Draw ZEN_MARK_PATH with `markTransform`, stroke `markStrokeWidth`, round caps and joins, vermilion;
// fill `textPath` ("en Staff", Young Serif outlines) with the text colour.
export const ZEN_LOCKUP_SMALL = {
  width: 542.45,
  height: 94.18,
  markTransform: "translate(-19.6072 -28.9347) scale(3.1371)",
  markStrokeWidth: 4.5,
  textPath:
    "M123.1 72.3Q124.9 76.8 129 80.4Q133 83.9 139.3 83.9Q142.7 83.9 146.5 82Q150.3 80 153.1 75.9Q153.4 75.4 154 75.4Q154.5 75.4 155.1 75.7Q155.7 76 158.3 77.5Q158.7 77.9 158.7 78.4Q158.7 79.2 158.1 80.2Q155.1 85.9 149.9 89.4Q144.7 93 136.4 93Q127.4 93 120.9 89Q114.4 85 110.9 78.4Q107.4 71.8 107.4 64Q107.4 56.6 109.6 51.2Q111.9 45.9 115.5 42.6Q119.2 39.3 123.8 37.7Q128.4 36.2 133.1 36.2Q138.5 36.2 142.6 38.3Q146.7 40.4 149.6 43.6Q152.5 46.9 153.9 50.5Q155.4 54.1 155.4 57.2Q155.4 58.1 154.4 58.5ZM139.2 56.8Q139.2 51.6 136.7 48.3Q134.2 44.9 130.4 44.9Q126 44.9 123.4 48.4Q120.8 51.9 120.8 57.2Q120.8 58.9 121 61.2Q121.1 63.6 121.8 65.6ZM222.3 56.4V74.8Q222.3 80.8 224.2 82.9Q226.1 85.1 229.3 85.1H230.1Q231.7 85.1 231.7 86.7V90Q231.7 91.6 230.1 91.6H201.4Q199.8 91.6 199.8 90V86.7Q199.8 85.1 201.4 85.1H202.1Q204.4 85.1 205.8 82.9Q207.2 80.8 207.2 74.8V56.4Q207.2 51.2 205.6 48.4Q204 45.7 199.4 45.7Q196.7 45.7 194 47Q191.3 48.4 189.3 50.5Q187.2 52.6 186.3 55V74.8Q186.3 79.2 188.2 82.1Q190 85.1 193.2 85.1H193.4Q195 85.1 195 86.7V90Q195 91.6 193.4 91.6H163Q161.4 91.6 161.4 90V86.7Q161.4 85.1 163 85.1H163.3Q167.3 85.1 169.2 82.1Q171.1 79.2 171.1 74.8V61.2Q171.1 58.3 170.8 55.6Q170.4 52.9 169 51Q167.7 49.1 164.7 48.8Q163.5 48.7 163.5 47.4V43.7Q163.5 42.7 165 42.3Q172.8 41.1 178.3 38.7Q183.9 36.2 186.1 34.7Q186.6 34.2 186.9 34.2H187Q187.2 34.2 187.2 34.5Q187.2 34.7 187.1 35.3L185.3 48.6Q186.8 46.1 189.3 43.3Q191.8 40.4 195.4 38.3Q199.1 36.2 204 36.2Q209.8 36.2 213.5 37.9Q217.2 39.6 219 42.6Q220.9 45.5 221.6 49Q222.3 52.6 222.3 56.4ZM327.2 35.1Q326.9 35.2 326.6 35.4Q326.2 35.5 325.9 35.5Q325 35.5 324.1 34.2Q317.2 25.6 310.5 21.8Q303.8 18 296.6 18Q292.3 18 289.2 20.3Q286.2 22.6 286.2 27.4Q286.2 31.4 288.7 34Q291.1 36.6 295.1 38.3Q299 40 303.1 41.1Q309.3 42.9 315.3 45Q321.3 47.2 326.1 50.2Q331 53.1 333.9 57.4Q336.8 61.7 336.8 67.7Q336.8 75.1 333.1 80.8Q329.4 86.5 322.3 89.7Q315.3 93 305.4 93Q300.5 93 296.3 91.7Q292 90.5 288 88.6Q287.1 88.1 286.4 88.1Q285.4 88.1 285.4 89.2Q285.4 89.5 285.6 90.4Q286 91.2 286 91.7Q286 92.9 284.1 92.9H278.7Q276.8 92.9 276 91.4L262.9 66.9Q262.5 66 262.5 65.6Q262.5 64.4 263.7 63.7L268.5 61Q268.8 60.8 269.1 60.7Q269.4 60.6 269.8 60.6Q270.8 60.6 271.6 61.9Q278.9 73 287.8 78.4Q296.8 83.8 306 83.8Q313.1 83.8 316.8 80.6Q320.6 77.4 320.6 72.6Q320.6 67.8 318.2 65.1Q315.9 62.4 310.9 60.6Q305.9 58.8 298.2 56.5Q292.9 55 287.7 52.8Q282.5 50.7 278.3 47.6Q274.1 44.5 271.5 40.2Q269 36 269 30.1Q269 23 272.6 18.4Q276.2 13.7 282.4 11.5Q288.5 9.3 296.3 9.3Q302.4 9.3 306.6 10.8Q310.8 12.3 313.1 13.6Q314.9 14.7 315.5 14.7Q316.1 14.7 316.1 14Q316.1 13.5 315.8 12.5Q315.5 11.6 315.5 10.5Q315.5 8.9 317.5 8.9H321.4Q323.3 8.9 324.1 10.7L331.6 30Q331.9 30.5 332 30.8Q332.1 31.2 332.1 31.5Q332.1 32.5 330.9 33.2ZM379.2 83.8Q379.5 84.2 379.5 84.8Q379.5 85.4 378.6 86L375.4 88Q372.5 89.9 368.4 91.4Q364.3 93 360.1 93Q356.9 93 354 91.5Q351.2 90 349.5 86.3Q347.7 82.7 347.7 76.4V56.4Q347.7 53.5 347.4 50.6Q347.1 47.7 345.4 45.9Q343.7 44.1 339.8 44.1Q338.2 44.1 338.2 42.4V39.2Q338.2 37.6 339.8 37.6H347.7V30.3Q347.7 28.9 348.7 28.4Q351.1 27.1 355 24.8Q358.9 22.5 361.9 19.4Q362.1 19.2 362.4 19.2H362.6Q362.8 19.2 362.8 19.5V37.6H377.3Q378.9 37.6 378.9 39.2V43.8Q378.9 45.5 377.3 45.5H362.8V76.4Q362.8 80.6 364.1 82.1Q365.4 83.7 367.4 83.7Q369.2 83.7 371.3 82.7Q373.3 81.6 375.1 80.6Q375.8 80.1 376.2 80.1Q376.9 80.1 377.4 81ZM437.3 71.6Q437.3 75.5 438.4 78.6Q439.6 81.6 443.6 82.2Q444.9 82.3 444.9 83.6V87.2Q444.9 88.7 443.3 88.7Q438 88.7 434.5 89.3Q431 89.9 428.5 90.8Q425.9 91.7 423.4 92.8Q423 93 422.7 93H422.4Q422.1 93 422.1 92.6Q422.1 92.1 422.4 90.5Q422.6 88.8 422.8 86.7Q423.1 84.6 423.3 83.1Q422.8 84.5 421 86.8Q419.2 89.2 415.8 91.1Q412.4 93 406.9 93Q403.2 93 399.1 91.5Q394.9 90 391.3 86.6Q387.6 83.3 385.3 77.8Q382.9 72.4 382.9 64.5Q382.9 54.4 386.6 48.2Q390.2 42 395.9 39.1Q401.7 36.2 408.2 36.2Q413.5 36.2 417.9 37.8Q422.4 39.4 425.7 42.4Q428.5 41.3 430.5 40.2Q432.5 39.2 433.9 38.1Q434.5 37.7 435 37.3Q435.6 36.8 436.4 36.4Q436.7 36.2 436.9 36.2H437Q437.3 36.2 437.3 36.4ZM422.1 54.6Q421.8 52.5 420.6 49.8Q419.3 47.2 416.8 45.3Q414.4 43.4 410.2 43.4Q405 43.4 402.1 46Q399.1 48.5 398 52.5Q396.9 56.5 396.9 61Q396.9 71.4 401 77.4Q405.2 83.5 411.8 83.5Q415.7 83.5 417.9 81.8Q420.1 80.1 421.1 78.4Q422 76.7 422.1 76.4ZM460.2 36.7Q460.2 31.9 461.3 26.4Q462.5 21 465.3 16.1Q468 11.3 472.7 8.3Q477.4 5.2 484.6 5.2Q493.2 5.2 497.4 8.5Q501.5 11.8 501.5 16.6Q501.5 19.4 500.4 22Q500.1 22.8 499.5 23.3Q498.9 23.9 497.7 24.1Q495.8 24.5 493.1 25.1Q490.5 25.7 488.4 26.1Q486.3 26.6 486 26.6Q485.3 26.6 485.3 25.6Q485.3 25.1 485.6 24.4Q487.7 20.3 487.7 17.3Q487.7 14.3 486.1 12.7Q484.6 11.1 482.6 11.1Q480 11.1 478.1 13.5Q476 15.9 475.3 20.1Q474.6 24.3 474.6 30.5V37.6H501.1V36.7Q501.1 31.9 502.3 26.4Q503.5 21 506.2 16.1Q509 11.3 513.7 8.3Q518.4 5.2 525.5 5.2Q534.1 5.2 538.3 8.5Q542.5 11.8 542.5 16.6Q542.5 19.4 541.4 22Q541 22.8 540.5 23.3Q539.9 23.9 538.7 24.1Q536.7 24.5 534.1 25.1Q531.4 25.7 529.3 26.1Q527.2 26.6 526.9 26.6Q526.3 26.6 526.3 25.6Q526.3 25.1 526.6 24.4Q528.6 20.3 528.6 17.3Q528.6 14.3 527.1 12.7Q525.5 11.1 523.6 11.1Q521 11.1 519 13.5Q517 15.9 516.3 20.1Q515.6 24.3 515.6 30.5V37.6H530Q531.7 37.6 531.7 39.2V43.8Q531.7 45.5 530 45.5H515.6V74.8Q515.6 79.2 517.6 82.1Q519.6 85.1 523.6 85.1Q525.2 85.1 525.2 86.7V90Q525.2 91.6 523.6 91.6H493.1Q491.5 91.6 491.5 90V86.7Q491.5 85.1 493.1 85.1Q497.1 85.1 499 82.1Q501 79.2 501 74.8V56.4Q501 49.6 498.2 47.5Q495.5 45.5 488.8 45.5H474.6V74.8Q474.6 79.2 476.6 82.1Q478.6 85.1 482.6 85.1Q484.2 85.1 484.2 86.7V90Q484.2 91.6 482.6 91.6H452.2Q450.5 91.6 450.5 90V86.7Q450.5 85.1 452.2 85.1Q456.2 85.1 458.1 82.1Q460 79.2 460 74.8V56.4Q460 53.5 459.7 50.6Q459.4 47.7 457.7 45.9Q456.1 44.1 452.2 44.1Q450.5 44.1 450.5 42.4V39.2Q450.5 37.6 452.2 37.6H460.2Z",
} as const;
// zen-lockup:end

/** ZEN_HOME is Zen's name for T3CODE_HOME and wins when both are set; call before reading env. */
export function applyZenHomeEnv(env: Record<string, string | undefined>): void {
  const zenHome = env.ZEN_HOME?.trim();
  if (zenHome) env.T3CODE_HOME = zenHome;
}

/**
 * The path someone meant when typing into a path field that already starts with `~/` (the Add
 * folder dialog does). A full path typed or pasted after it (`~//srv/x`, `~/~/x`, `~/C:\x`)
 * stays that path: an absolute path stays absolute and `~` expands once. Anything else is
 * returned unchanged.
 */
export function zenTypedPath(value: string): string {
  let out = value;
  while (out.length > 2 && out[0] === "~" && (out[1] === "/" || out[1] === "\\")) {
    const rest = out.slice(2);
    const absolute =
      rest.startsWith("/") || rest.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(rest);
    const homeAgain = rest === "~" || /^~[\\/]/.test(rest);
    if (!absolute && !homeAgain) break;
    out = rest;
  }
  return out;
}
