import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CoveTarget } from "./config.js";
import { ProjectConfigError, resolveProjectPath, type LoadedProject } from "./config.js";

export interface DiscoveredSources {
  readonly cove: readonly string[];
  readonly c: readonly string[];
}

export async function findProjectConfig(startDirectory = process.cwd()): Promise<string | null> {
  let directory = resolve(startDirectory);
  for (;;) {
    const candidate = resolve(directory, "cove.json");
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Keep walking toward the filesystem root. */ }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function globRegex(pattern: string): RegExp {
  let output = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index++;
        if (pattern[index + 1] === "/") {
          index++;
          output += "(?:.*/)?";
        } else output += ".*";
      } else output += "[^/]*";
    } else if (char === "?") output += "[^/]";
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${output}$`);
}

async function walk(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "build" || entry.name === "dist") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function expandPattern(project: LoadedProject, pattern: string): Promise<string[]> {
  const absolutePattern = resolveProjectPath(project, pattern);
  const hasGlob = /[*?]/.test(pattern);
  if (!hasGlob) {
    try {
      if ((await stat(absolutePattern)).isFile()) return [absolutePattern];
    } catch { /* Report a consistent missing source below. */ }
    throw new ProjectConfigError(`Source path '${pattern}' does not exist or is not a file`);
  }

  const normalizedPattern = relative(project.root, absolutePattern).split(sep).join("/");
  const basePart = normalizedPattern.split(/[*?]/, 1)[0] ?? "";
  const baseDirectory = resolve(project.root, dirname(basePart.endsWith("/") ? `${basePart}placeholder` : basePart || "."));
  const regex = globRegex(normalizedPattern);
  const candidates = await walk(baseDirectory);
  return candidates.filter((candidate) => regex.test(relative(project.root, candidate).split(sep).join("/"))).sort();
}

export async function discoverTargetSources(project: LoadedProject, target: CoveTarget): Promise<DiscoveredSources> {
  const cove = new Set<string>();
  const c = new Set<string>();
  for (const pattern of target.sources) {
    const matches = await expandPattern(project, pattern);
    if (matches.length === 0) throw new ProjectConfigError(`Source pattern '${pattern}' matched no files`);
    for (const match of matches) {
      if (!match.endsWith(".cove")) throw new ProjectConfigError(`Cove source pattern '${pattern}' matched non-.cove file '${relative(project.root, match)}'`);
      cove.add(match);
    }
  }
  for (const pattern of target.cSources) {
    const matches = await expandPattern(project, pattern);
    if (matches.length === 0) throw new ProjectConfigError(`C source pattern '${pattern}' matched no files`);
    for (const match of matches) {
      if (!/\.(c|cc|cpp|cxx)$/i.test(match)) throw new ProjectConfigError(`C source pattern '${pattern}' matched unsupported source '${relative(project.root, match)}'`);
      c.add(match);
    }
  }
  if (target.entry) {
    const entry = resolveProjectPath(project, target.entry);
    if (!cove.has(entry)) throw new ProjectConfigError(`Target entry '${target.entry}' is not included in its sources`);
  }
  return { cove: [...cove].sort(), c: [...c].sort() };
}
