import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export type CoveTargetType = "executable" | "object" | "static" | "shared";

export interface CoveProjectMetadata {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly license?: string;
}

export interface CovePaths {
  readonly source: readonly string[];
  readonly modules: readonly string[];
  readonly include: readonly string[];
  readonly build: string;
}

export interface CoveCompilerConfig {
  readonly c: string;
  readonly standard: string;
  readonly optimization: "O0" | "O1" | "O2" | "O3" | "Os" | "Oz";
  readonly flags: readonly string[];
  readonly linkerFlags: readonly string[];
  readonly includeDirs: readonly string[];
  readonly libraryDirs: readonly string[];
  readonly libraries: readonly string[];
}

export interface CoveTarget {
  readonly type: CoveTargetType;
  readonly entry?: string;
  readonly sources: readonly string[];
  readonly cSources: readonly string[];
  readonly output: string;
  readonly libraries: readonly string[];
  readonly includeDirs: readonly string[];
  readonly libraryDirs: readonly string[];
}

export interface ProjectConfig {
  readonly project: CoveProjectMetadata;
  readonly defaultTarget: string;
  readonly paths: CovePaths;
  readonly compiler: CoveCompilerConfig;
  readonly targets: Readonly<Record<string, CoveTarget>>;
}

export interface LoadedProject {
  readonly root: string;
  readonly configPath: string;
  readonly config: ProjectConfig;
}

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigError";
  }
}

const DEFAULTS = {
  paths: { source: ["src"], modules: ["src", "modules"], include: ["include"], build: "build" },
  compiler: { c: "auto", standard: "c11", optimization: "O0", flags: [], linkerFlags: [] },
} as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectConfigError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProjectConfigError(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string, fallback: readonly string[]): readonly string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ProjectConfigError(`${label} must be an array of non-empty strings`);
  }
  return value as string[];
}

function parseConfig(value: unknown): ProjectConfig {
  const root = object(value, "Project configuration");
  const project = object(root.project, "project");
  const paths = root.paths === undefined ? {} : object(root.paths, "paths");
  const compiler = root.compiler === undefined ? {} : object(root.compiler, "compiler");
  const rawTargets = object(root.targets, "targets");
  const targets: Record<string, CoveTarget> = {};

  for (const [name, rawTarget] of Object.entries(rawTargets)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new ProjectConfigError(`Invalid target name '${name}'`);
    const target = object(rawTarget, `targets.${name}`);
    const type = string(target.type, `targets.${name}.type`);
    if (type !== "executable" && type !== "object" && type !== "static" && type !== "shared") {
      throw new ProjectConfigError(`targets.${name}.type must be 'executable', 'object', 'static', or 'shared'`);
    }
    const entry = target.entry === undefined ? undefined : string(target.entry, `targets.${name}.entry`);
    const sources = stringArray(target.sources, `targets.${name}.sources`, entry ? [entry] : []);
    const cSources = stringArray(target.cSources, `targets.${name}.cSources`, []);
    if (sources.length === 0 && cSources.length === 0) {
      throw new ProjectConfigError(`targets.${name} must declare at least one source in 'sources' or 'cSources'`);
    }
    targets[name] = {
      type,
      ...(entry === undefined ? {} : { entry }),
      sources,
      cSources,
      output: string(target.output, `targets.${name}.output`, name),
      libraries: stringArray(target.libraries, `targets.${name}.libraries`, []),
      includeDirs: stringArray(target.includeDirs, `targets.${name}.includeDirs`, []),
      libraryDirs: stringArray(target.libraryDirs, `targets.${name}.libraryDirs`, []),
    };
  }

  const defaultTarget = string(root.defaultTarget, "defaultTarget", Object.keys(targets)[0]);
  if (!targets[defaultTarget]) throw new ProjectConfigError(`defaultTarget '${defaultTarget}' does not exist in targets`);

  const optimization = string(compiler.optimization, "compiler.optimization", DEFAULTS.compiler.optimization);
  if (!["O0", "O1", "O2", "O3", "Os", "Oz"].includes(optimization)) {
    throw new ProjectConfigError("compiler.optimization must be one of O0, O1, O2, O3, Os, or Oz");
  }

  return {
    project: {
      name: string(project.name, "project.name"),
      version: string(project.version, "project.version", "0.1.0"),
      ...(project.description === undefined ? {} : { description: string(project.description, "project.description") }),
      ...(project.author === undefined ? {} : { author: string(project.author, "project.author") }),
      ...(project.license === undefined ? {} : { license: string(project.license, "project.license") }),
    },
    defaultTarget,
    paths: {
      source: stringArray(paths.source, "paths.source", DEFAULTS.paths.source),
      modules: stringArray(paths.modules, "paths.modules", DEFAULTS.paths.modules),
      include: stringArray(paths.include, "paths.include", DEFAULTS.paths.include),
      build: string(paths.build, "paths.build", DEFAULTS.paths.build),
    },
    compiler: {
      c: string(compiler.c, "compiler.c", DEFAULTS.compiler.c),
      standard: string(compiler.standard, "compiler.standard", DEFAULTS.compiler.standard),
      optimization: optimization as CoveCompilerConfig["optimization"],
      flags: stringArray(compiler.flags, "compiler.flags", []),
      linkerFlags: stringArray(compiler.linkerFlags, "compiler.linkerFlags", []),
      includeDirs: stringArray(compiler.includeDirs, "compiler.includeDirs", []),
      libraryDirs: stringArray(compiler.libraryDirs, "compiler.libraryDirs", []),
      libraries: stringArray(compiler.libraries, "compiler.libraries", []),
    },
    targets,
  };
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  return parseConfig(value);
}

export async function loadProjectConfig(configPath: string): Promise<LoadedProject> {
  const absoluteConfigPath = resolve(configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absoluteConfigPath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProjectConfigError(`Invalid JSON in ${absoluteConfigPath}: ${error.message}`);
    throw error;
  }
  return {
    root: resolve(absoluteConfigPath, ".."),
    configPath: absoluteConfigPath,
    config: parseConfig(parsed),
  };
}

export function resolveProjectPath(project: LoadedProject, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(project.root, path);
}
