import { readFile, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import type { LoadedProject } from "./config.js";
import type { DiscoveredSources } from "./discovery.js";
import { resolveProjectPath, ProjectConfigError } from "./config.js";

export interface ModuleImport { readonly name: string; readonly source: string; }
export interface ModuleGraph { readonly order: readonly string[]; readonly imports: ReadonlyMap<string, readonly ModuleImport[]>; readonly nativeHeaders: ReadonlyMap<string, readonly string[]>; }

const IMPORT_RE = /^\s*import\s+(?:([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?|("[^"]+"|<[^>]+>))\s*;\s*$/gm;

function moduleName(path: string, roots: readonly string[], project: LoadedProject): string {
  for (const root of roots) {
    const absoluteRoot = resolveProjectPath(project, root);
    const rel = relative(absoluteRoot, path);
    if (!rel.startsWith("..") && !rel.startsWith(`..${sep}`)) return rel.replace(/\.cove$/, "").split(sep).join(".");
  }
  return relative(project.root, path).replace(/\.cove$/, "").split(sep).join(".");
}

async function resolveImport(name: string, project: LoadedProject, known: readonly string[]): Promise<string> {
  const relativePath = name.split(".").join("/");
  const candidates = [
    ...project.config.paths.modules.map((root) => resolve(resolveProjectPath(project, root), `${relativePath}.cove`)),
    resolve(project.root, `${relativePath}.cove`),
  ];
  for (const candidate of candidates) {
    if (known.includes(candidate)) return candidate;
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* try next module root */ }
  }
  throw new ProjectConfigError(`Cannot resolve module '${name}'. Searched: ${candidates.map((p) => relative(project.root, p)).join(", ")}`);
}

export async function buildModuleGraph(project: LoadedProject, sources: DiscoveredSources): Promise<ModuleGraph> {
  const known = [...sources.cove];
  const imports = new Map<string, ModuleImport[]>();
  const nativeHeaders = new Map<string, string[]>();
  const edges = new Map<string, string[]>();
  for (const source of known) {
    const text = await readFile(source, "utf8");
    const entries: ModuleImport[] = [];
    for (const match of text.matchAll(IMPORT_RE)) {
      const name = match[1];
      const native = match[3];
      if (native) {
        nativeHeaders.set(source, [...(nativeHeaders.get(source) ?? []), native.startsWith("<") ? native : native.slice(1, -1)]);
        continue;
      }
      if (!name) continue;
      const resolved = await resolveImport(name, project, known);
      entries.push({ name, source: resolved });
    }
    imports.set(source, entries);
    edges.set(source, entries.map((entry) => entry.source));
  }

  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (source: string, chain: string[]): void => {
    const current = state.get(source) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const cycle = [...chain, source].map((p) => relative(project.root, p)).join(" -> ");
      throw new ProjectConfigError(`Circular module dependency: ${cycle}`);
    }
    state.set(source, 1);
    for (const dependency of edges.get(source) ?? []) visit(dependency, [...chain, source]);
    state.set(source, 2);
    order.push(source);
  };
  const entry = sources.cove.find((path) => path.endsWith("/main.cove")) ?? sources.cove[0]!;
  visit(entry, []);
  for (const source of known) visit(source, []);
  return { order, imports, nativeHeaders };
}

export async function combineProjectSources(project: LoadedProject, graph: ModuleGraph, entry?: string): Promise<{ path: string; text: string }> {
  const ordered = entry ? [entry, ...graph.order.filter((p) => p !== entry)] : [...graph.order];
  const chunks: string[] = [];
  for (const source of ordered) {
    const original = await readFile(source, "utf8");
    const withoutImports = original.replace(IMPORT_RE, (match) => match.replace(/[^\r\n]/g, " "));
    chunks.push(`/* Cove module: ${relative(project.root, source)} */\n${withoutImports}`);
  }
  return { path: resolve(project.root, project.config.paths.build, "generated", "project.cove"), text: chunks.join("\n\n") };
}

export function moduleNameForSource(source: string, project: LoadedProject): string {
  return moduleName(source, project.config.paths.modules, project);
}
