// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - plain async code that runs outside the Effect runtime (wrapped by ZenToolchains.ts).
// Zen Staff: the machine probe (no admin rights, about a second): OS, CPU, RAM, free disk, GPUs
// (nvidia-smi, a CIM query on Windows, system_profiler on macOS), tools on PATH, download hosts,
// a writable tools folder and the sandbox available. Parsers are pure and tested.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ZenGpuInfo, ZenMachineProbe, ZenSandboxKind } from "@t3tools/contracts/zenToolchains";

const GIB = 1024 ** 3;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits` */
export function parseNvidiaSmiQuery(text: string, cuda: string | null): ZenGpuInfo[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("NVIDIA-SMI has failed"))
    .flatMap((line) => {
      const [name, memory, driver] = line.split(",").map((part) => part.trim());
      if (!name) return [];
      const mib = Number.parseFloat(memory ?? "");
      return [
        {
          vendor: "nvidia" as const,
          name,
          vramGb: Number.isFinite(mib) ? round1(mib / 1024) : null,
          cuda,
          metal: false,
          driver: driver || null,
        },
      ];
    });
}

/** The "CUDA Version: 12.4" field of plain `nvidia-smi` output. */
export function parseNvidiaSmiCudaVersion(text: string): string | null {
  return /CUDA Version:\s*([\d.]+)/.exec(text)?.[1] ?? null;
}

function vendorOf(text: string): ZenGpuInfo["vendor"] {
  const lower = text.toLowerCase();
  if (lower.includes("nvidia")) return "nvidia";
  if (lower.includes("amd") || lower.includes("radeon") || lower.includes("advanced micro"))
    return "amd";
  if (lower.includes("intel")) return "intel";
  if (lower.includes("apple")) return "apple";
  return "other";
}

/**
 * Output of the Windows query below: Win32_VideoController rows as JSON (one object or an
 * array). AdapterRAM is a 32-bit field (caps at 4 GB), so the registry's qwMemorySize wins.
 */
export function parseWindowsVideoControllers(text: string): ZenGpuInfo[] {
  let json: unknown;
  try {
    json = JSON.parse(text.trim() || "[]");
  } catch {
    return [];
  }
  const rows = (Array.isArray(json) ? json : [json]) as Array<Record<string, unknown>>;
  return rows.flatMap((row) => {
    const name = typeof row.Name === "string" ? row.Name : null;
    if (!name || /basic display|remote display|virtual/i.test(name)) return [];
    const qw = Number(row.QwMemorySize ?? 0);
    const adapter = Number(row.AdapterRAM ?? 0);
    const bytes = qw > 0 ? qw : adapter > 0 ? adapter : 0;
    return [
      {
        vendor: vendorOf(`${String(row.AdapterCompatibility ?? "")} ${name}`),
        name,
        vramGb: bytes > 0 ? round1(bytes / GIB) : null,
        cuda: null,
        metal: false,
        driver: typeof row.DriverVersion === "string" ? row.DriverVersion : null,
      },
    ];
  });
}

/** `system_profiler SPDisplaysDataType -json`. Apple silicon shares memory with the CPU. */
export function parseSystemProfilerDisplays(text: string, totalRamGb: number): ZenGpuInfo[] {
  let json: { SPDisplaysDataType?: Array<Record<string, unknown>> };
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  return (json.SPDisplaysDataType ?? []).flatMap((row) => {
    const name = String(row.sppci_model ?? row._name ?? "");
    if (!name) return [];
    const vendorText = `${String(row.spdisplays_vendor ?? "")} ${name}`;
    const vendor = vendorOf(vendorText);
    const vramText = String(row.spdisplays_vram ?? row.spdisplays_vram_shared ?? "");
    const vramMatch = /([\d.]+)\s*(GB|MB)/i.exec(vramText);
    const vramGb = vramMatch
      ? round1(Number(vramMatch[1]) / (vramMatch[2]!.toUpperCase() === "MB" ? 1024 : 1))
      : vendor === "apple"
        ? round1(totalRamGb * 0.75)
        : null;
    const metal = Object.entries(row).some(
      ([key, value]) =>
        key.includes("mtlgpufamilysupport") || (key.includes("metal") && Boolean(value)),
    );
    return [{ vendor, name, vramGb, cuda: null, metal: metal || vendor === "apple", driver: null }];
  });
}

/** MemAvailable from /proc/meminfo (Linux counts page cache as free, unlike os.freemem). */
export function parseMemAvailableGb(text: string): number | null {
  const kb = /MemAvailable:\s+(\d+)\s+kB/.exec(text)?.[1];
  return kb ? round1(Number(kb) / 1024 / 1024) : null;
}

const WINDOWS_GPU_QUERY = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$reg=@{};",
  "Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' |",
  " ForEach-Object { $p=Get-ItemProperty $_.PSPath; if ($p.DriverDesc) { $reg[$p.DriverDesc]=$p.'HardwareInformation.qwMemorySize' } };",
  "Get-CimInstance Win32_VideoController | ForEach-Object {",
  " [pscustomobject]@{Name=$_.Name;AdapterRAM=$_.AdapterRAM;DriverVersion=$_.DriverVersion;",
  " AdapterCompatibility=$_.AdapterCompatibility;QwMemorySize=$reg[$_.Name]} } | ConvertTo-Json -Compress",
].join("");

function run(
  command: string,
  args: ReadonlyArray<string>,
  timeoutMs = 4000,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      NodeChildProcess.execFile(
        command,
        args as string[],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => resolve(error ? null : String(stdout)),
      );
    } catch {
      resolve(null);
    }
  });
}

/** The first match of `name` on PATH (no process is started). */
export function findOnPath(name: string, envPath = process.env.PATH ?? ""): string | null {
  const pathext = process.env.PATHEXT;
  const extensions = pathext ? pathext.split(";").map((ext) => ext.toLowerCase()) : [""];
  for (const dir of envPath.split(NodePath.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = NodePath.join(dir, name + ext);
      try {
        const stat = NodeFS.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

async function detectGpus(os: ZenMachineProbe["os"], totalRamGb: number): Promise<ZenGpuInfo[]> {
  const smi = findOnPath("nvidia-smi") ?? (os === "windows" ? "nvidia-smi" : null);
  const nvidia: ZenGpuInfo[] = [];
  if (smi) {
    const [query, plain] = await Promise.all([
      run(smi, ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]),
      run(smi, []),
    ]);
    if (query)
      nvidia.push(...parseNvidiaSmiQuery(query, plain ? parseNvidiaSmiCudaVersion(plain) : null));
  }
  if (os === "windows") {
    const out = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_GPU_QUERY],
      6000,
    );
    const others = out ? parseWindowsVideoControllers(out) : [];
    // nvidia-smi knows VRAM and CUDA better; keep the CIM rows for other vendors.
    return [...nvidia, ...others.filter((gpu) => gpu.vendor !== "nvidia" || nvidia.length === 0)];
  }
  if (os === "macos") {
    const out = await run("system_profiler", ["SPDisplaysDataType", "-json"], 6000);
    return [...nvidia, ...(out ? parseSystemProfilerDisplays(out, totalRamGb) : [])];
  }
  return nvidia;
}

async function reachable(host: string, timeoutMs: number) {
  const started = Date.now();
  try {
    const response = await fetch(`https://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    void response.body?.cancel();
    return { host, reachable: true, ms: Date.now() - started };
  } catch {
    return { host, reachable: false, ms: null };
  }
}

/** bubblewrap on PATH that can actually create its namespaces here (AppArmor may forbid them). */
function bwrapWorks(): boolean {
  const program = findOnPath("bwrap");
  if (!program) return false;
  const result = NodeChildProcess.spawnSync(
    program,
    [
      "--unshare-user",
      "--uid",
      "65534",
      "--gid",
      "65534",
      "--cap-drop",
      "ALL",
      "--unshare-net",
      "--unshare-pid",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "true",
    ],
    { stdio: "ignore", timeout: 5000 },
  );
  return result.status === 0;
}

function detectSandbox(os: ZenMachineProbe["os"]): ZenSandboxKind {
  if (os === "linux" && bwrapWorks()) return "bwrap";
  if (os === "macos" && NodeFS.existsSync("/usr/bin/sandbox-exec")) return "sandbox-exec";
  return "none";
}

export interface ProbeOptions {
  readonly zenHome: string;
  readonly installDir: string;
  readonly downloadHosts: ReadonlyArray<string>;
  readonly pathNames: ReadonlyArray<string>;
  readonly companyRunner: boolean;
  /** HostProcess.Platform / Architecture, read by the Effect service. */
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Test hook: a JSON file whose fields replace the probed ones (ZEN_TOOLCHAIN_FAKE_PROBE). */
  readonly overrideFile?: string | null;
}

export async function probeMachine(options: ProbeOptions): Promise<ZenMachineProbe> {
  const started = Date.now();
  const platform = options.platform;
  const os: ZenMachineProbe["os"] =
    platform === "linux"
      ? "linux"
      : platform === "win32"
        ? "windows"
        : platform === "darwin"
          ? "macos"
          : "other";
  const arch: ZenMachineProbe["arch"] =
    options.arch === "x64" ? "x64" : options.arch === "arm64" ? "arm64" : "other";
  const totalRamGb = round1(NodeOS.totalmem() / GIB);
  let freeRamGb = round1(NodeOS.freemem() / GIB);
  if (os === "linux") {
    try {
      freeRamGb = parseMemAvailableGb(NodeFS.readFileSync("/proc/meminfo", "utf8")) ?? freeRamGb;
    } catch {
      // keep os.freemem
    }
  }
  let installDirWritable = false;
  try {
    NodeFS.mkdirSync(options.installDir, { recursive: true });
    NodeFS.accessSync(options.installDir, NodeFS.constants.W_OK);
    installDirWritable = true;
  } catch {
    installDirWritable = false;
  }
  let freeDiskGb: number | null = null;
  try {
    const stats = NodeFS.statfsSync(installDirWritable ? options.installDir : options.zenHome);
    freeDiskGb = round1((stats.bavail * stats.bsize) / GIB);
  } catch {
    freeDiskGb = null;
  }
  const [gpus, network] = await Promise.all([
    detectGpus(os, totalRamGb),
    Promise.all(options.downloadHosts.map((host) => reachable(host, 2500))),
  ]);
  const toolsOnPath: Record<string, string> = {};
  for (const name of options.pathNames) {
    const found = findOnPath(name);
    if (found) toolsOnPath[name] = found;
  }
  const cpus = NodeOS.cpus();
  let probe: ZenMachineProbe = {
    probedAt: new Date().toISOString(),
    durationMs: 0,
    os,
    arch,
    osVersion: NodeOS.release(),
    hostname: NodeOS.hostname(),
    cpuModel: cpus[0]?.model.trim() ?? "unknown",
    cpuCores: NodeOS.availableParallelism?.() ?? cpus.length,
    totalRamGb,
    freeRamGb,
    zenHome: options.zenHome,
    installDir: options.installDir,
    installDirWritable,
    freeDiskGb,
    gpus,
    toolsOnPath,
    network,
    sandbox: detectSandbox(os),
    companyRunner: options.companyRunner,
  };
  if (options.overrideFile) {
    try {
      const override = JSON.parse(
        NodeFS.readFileSync(options.overrideFile, "utf8"),
      ) as Partial<ZenMachineProbe>;
      probe = { ...probe, ...override };
    } catch {
      // A broken override file is ignored.
    }
  }
  return { ...probe, durationMs: Date.now() - started };
}
