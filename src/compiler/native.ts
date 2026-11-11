import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SourceFile } from "../diagnostics/source.js";
import { compileToC } from "./compile.js";
import { formatDiagnostic } from "../diagnostics/diagnostic.js";

export interface NativeBuildOptions {
  readonly output?: string;
  readonly compiler?: string;
  readonly standard?: string;
  readonly optimization?: string;
  readonly flags?: readonly string[];
  readonly linkerFlags?: readonly string[];
  readonly buildDirectory?: string;
}

export interface NativeBuildResult {
  readonly cPath: string;
  readonly executablePath: string;
  readonly compiler: string | null;
  readonly success: boolean;
  readonly diagnostics: string[];
}

export async function buildNative(file: SourceFile, options: NativeBuildOptions = {}): Promise<NativeBuildResult> {
  const compiled = compileToC(file);
  const buildDirectory = resolve(options.buildDirectory ?? "build");
  const generatedDirectory = resolve(buildDirectory, "generated");
  const cPath = resolve(generatedDirectory, "main.c");
  const executablePath = resolve(options.output ?? "build/cove-app");
  await mkdir(generatedDirectory, { recursive: true });
  await mkdir(dirname(executablePath), { recursive: true });

  const diagnostics = compiled.diagnostics.items.map(formatDiagnostic);
  if (compiled.diagnostics.hasErrors) {
    return { cPath, executablePath, compiler: null, success: false, diagnostics };
  }

  // Always persist generated C before invoking the system compiler, even if native compilation fails.
  await writeFile(cPath, compiled.cSource, "utf8");
  const candidates = options.compiler && options.compiler !== "auto" ? [options.compiler] : process.env.CC ? [process.env.CC, "gcc", "clang"] : ["gcc", "clang"];
  let selected: string | null = null;
  for (const candidate of [...new Set(candidates)]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) { selected = candidate; break; }
  }
  if (!selected) {
    diagnostics.push("error: no working C compiler found; install GCC or Clang, or set CC");
    return { cPath, executablePath, compiler: null, success: false, diagnostics };
  }

  const result = spawnSync(selected, [
    `-std=${options.standard ?? "c11"}`, "-Wall", "-Wextra",
    `-${options.optimization ?? "O0"}`, ...(options.flags ?? []), cPath,
    "-o", executablePath, ...(options.linkerFlags ?? []),
  ], { encoding: "utf8" });
  if (result.stdout.trim()) diagnostics.push(result.stdout.trim());
  if (result.stderr.trim()) diagnostics.push(result.stderr.trim());
  if (result.error) diagnostics.push(`error: failed to start ${selected}: ${result.error.message}`);
  return { cPath, executablePath, compiler: selected, success: result.status === 0, diagnostics };
}
