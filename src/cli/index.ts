#!/usr/bin/env node
import { readFile, stat, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { compileFrontend } from "../compiler/compile.js";
import { formatIR, lowerToIR } from "../compiler/ir.js";
import { analyzeCFG, validateSSA } from "../compiler/cfg.js";
import { constructSSA, eliminateCommonSubexpressions } from "../compiler/ssa.js";
import { formatOptimizationStats, optimizeIR } from "../compiler/optimize.js";
import { buildNative } from "../compiler/native.js";
import { formatDiagnostic } from "../diagnostics/diagnostic.js";
import { discoverTargetSources, findProjectConfig } from "../project/discovery.js";
import { loadProjectConfig, ProjectConfigError, resolveProjectPath, type LoadedProject } from "../project/config.js";
import { initializeProject } from "../project/init.js";
import { buildModuleGraph, combineProjectSources } from "../project/modules.js";
import { buildProjectNative } from "../project/native-build.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const valueOptions = new Set([
  "--project", "--name", "--version", "--description", "--author", "--license", "-o", "--cc",
]);
const positionals: string[] = [];
for (let index = 1; index < args.length; index++) {
  const value = args[index]!;
  if (valueOptions.has(value)) { index++; continue; }
  if (!value.startsWith("-")) positionals.push(value);
}
const input = positionals[0];
const quiet = args.includes("--quiet") || args.includes("-q");

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): void {
  process.stdout.write(
    "Cove — the C-superset compiler\n\n" +
    "Project commands:\n" +
    "  cove init [directory] [--name <name>] [--yes]\n" +
    "  cove targets [--project <directory|cove.json>]\n" +
    "  cove check [target] [--project <directory|cove.json>]\n" +
    "  cove build [target] [--project <directory|cove.json>]\n" +
    "  cove run [target] [--project <directory|cove.json>]\n" +
    "  cove clean [--project <directory|cove.json>]\n\n" +
    "Common options:\n  -q, --quiet       Suppress successful status output\n\n" +
    "Single-file commands:\n" +
    "  cove check <file.cove>\n" +
    "  cove ir <file.cove>\n" +
    "  cove opt <file.cove>\n" +
    "  cove cfg <file.cove>\n" +
    "  cove build <file.cove> [-o <executable>] [--cc <compiler>]\n" +
    "  cove run <file.cove> [-o <executable>] [--cc <compiler>]\n" +
    "  cove lsp\n",
  );
}

async function loadProjectFromOption(): Promise<LoadedProject | null> {
  const explicit = option("--project");
  let configPath: string | null;
  if (explicit) {
    const candidate = resolve(explicit);
    try { configPath = (await stat(candidate)).isDirectory() ? resolve(candidate, "cove.json") : candidate; }
    catch { configPath = candidate; }
  } else configPath = await findProjectConfig();
  return configPath ? loadProjectConfig(configPath) : null;
}

function selectTarget(project: LoadedProject, requested?: string) {
  const name = requested ?? project.config.defaultTarget;
  const target = project.config.targets[name];
  if (!target) throw new ProjectConfigError(`Unknown target '${name}'. Run 'cove targets' to list available targets.`);
  return { name, target };
}

async function checkProject(project: LoadedProject, requested?: string): Promise<boolean> {
  const { name, target } = selectTarget(project, requested);
  const sources = await discoverTargetSources(project, target);
  const graph = await buildModuleGraph(project, sources);
  const entry = target.entry ? resolveProjectPath(project, target.entry) : graph.order[graph.order.length - 1]!;
  const combined = await combineProjectSources(project, graph, entry);
  const result = compileFrontend(combined);
  for (const diagnostic of result.diagnostics.items) process.stderr.write(`${formatDiagnostic(diagnostic)}\\n`);
  if (!result.diagnostics.hasErrors && !quiet) {
    for (const path of graph.order) process.stdout.write(`Checked ${resolve(path)}\\n`);
    process.stdout.write(`Project '${project.config.project.name}' target '${name}': ${sources.cove.length} Cove source file(s), ${sources.c.length} C source file(s), ${graph.order.length} module(s).\\n`);
  }
  return !result.diagnostics.hasErrors;
}

async function buildProject(project: LoadedProject, requested: string | undefined, run: boolean): Promise<void> {
  const { name, target } = selectTarget(project, requested);
  if (run && target.type !== "executable") throw new ProjectConfigError(`Target '${name}' is '${target.type}' and cannot be run; only executable targets can be run.`);
  const sources = await discoverTargetSources(project, target);
  const graph = await buildModuleGraph(project, sources);
  const result = await buildProjectNative(project, target, sources, graph);
  for (const diagnostic of result.diagnostics) process.stderr.write(`${diagnostic}\n`);
  if (!result.success) throw new Error(`Native build failed for target '${name}'`);
  if (!quiet) process.stdout.write(`Project: ${project.config.project.name}\nTarget: ${name} (${target.type})\nModules: ${graph.order.length}\nGenerated files: ${result.generated.length}\nOutput: ${result.output}\nCompiled with ${result.compiler}\n`);
  if (run) {
    const execution = spawnSync(result.output, [], { stdio: "inherit" });
    if (execution.error) throw new Error(`Could not run executable: ${execution.error.message}`);
    process.exitCode = execution.status ?? 1;
  }
}

async function runSingleFile(command: string, file: string): Promise<void> {
  const path = resolve(file);
  const text = await readFile(path, "utf8");
  if (command === "check" || command === "ir" || command === "opt" || command === "cfg") {
    const result = compileFrontend({ path: file, text });
    for (const diagnostic of result.diagnostics.items) process.stderr.write(`${formatDiagnostic(diagnostic)}\n`);
    if (result.diagnostics.hasErrors) process.exitCode = 1;
    else if (command === "ir" && result.typedProgram) process.stdout.write(formatIR(lowerToIR(result.typedProgram)));
    else if (command === "opt" && result.typedProgram) {
      const optimized = optimizeIR(lowerToIR(result.typedProgram));
      const ssa = constructSSA(optimized.module);
      const cse = eliminateCommonSubexpressions(ssa.module);
      process.stdout.write(formatIR(cse.module));
      process.stdout.write(`\n${formatOptimizationStats(optimized.stats)}\nSSA: ${ssa.promotedSlots} stack slot(s) promoted, ${ssa.insertedPhis} phi node(s) inserted.\nCSE: ${cse.eliminated} common expression(s) eliminated.\n`);
    } else if (command === "cfg" && result.typedProgram) {
      const module = lowerToIR(result.typedProgram);
      for (const fn of module.functions) {
        const cfg = analyzeCFG(fn);
        process.stdout.write(`CFG @${fn.name}\n`);
        for (const block of fn.blocks) {
          process.stdout.write(`  ${block.name}: preds=[${[...(cfg.predecessors.get(block.name) ?? [])].join(", ")}] succs=[${[...(cfg.successors.get(block.name) ?? [])].join(", ")}]\n`);
          process.stdout.write(`    reachable=${cfg.reachable.has(block.name)} dom={${[...(cfg.dominators.get(block.name) ?? [])].join(", ")}} idom=${cfg.immediateDominators.get(block.name) ?? "<none>"} frontier={${[...(cfg.dominanceFrontiers.get(block.name) ?? [])].join(", ")}}\n`);
        }
      }
      const errors = validateSSA(module);
      process.stdout.write(errors.length ? `SSA validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n` : "SSA validation: passed\n");
      if (errors.length) process.exitCode = 1;
    } else process.stdout.write(`Checked ${file}: ${result.program.declarations.length} top-level declaration(s), ${result.tokens.length - 1} token(s).\n`);
    return;
  }

  const output = option("-o");
  const compiler = option("--cc");
  const result = await buildNative({ path: file, text }, {
    ...(output === undefined ? {} : { output }),
    ...(compiler === undefined ? {} : { compiler }),
  });
  for (const diagnostic of result.diagnostics) process.stderr.write(`${diagnostic}\n`);
  if (!result.success) { process.exitCode = 1; return; }
  if (!quiet) process.stdout.write(`Generated C: ${result.cPath}\nCompiled with ${result.compiler}: ${result.executablePath}\n`);
  if (command === "run") {
    const execution = spawnSync(result.executablePath, [], { stdio: "inherit" });
    if (execution.error) throw new Error(`Could not run executable: ${execution.error.message}`);
    process.exitCode = execution.status ?? 1;
  }
}

try {
  if (command === "--version" || command === "-v" || command === "version") {
    const packageVersion = "0.1.4";
    process.stdout.write(`Cove ${packageVersion}\n`);
  } else if (command === "lsp") await import("./lsp.js");
  else if (command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "init") {
    const directory = input ? resolve(input) : process.cwd();
    const defaults = {
      name: option("--name") ?? basename(directory),
      version: option("--version") ?? "0.1.0",
      description: option("--description") ?? "",
      author: option("--author") ?? "",
      license: option("--license") ?? "MIT",
    };
    let details = defaults;
    if (stdin.isTTY && stdout.isTTY && !args.includes("--yes") && !args.includes("-y")) {
      const terminal = createInterface({ input: stdin, output: stdout });
      const ask = async (label: string, fallback: string): Promise<string> => {
        const answer = await terminal.question(`${label} (${fallback}): `);
        return answer.trim() || fallback;
      };
      try {
        process.stdout.write("\n  Cove project initializer\n  Let's set up your project. Press Enter to accept a default.\n\n");
        details = {
          name: await ask("  Project name", defaults.name),
          version: await ask("  Version", defaults.version),
          description: await ask("  Description", defaults.description || "(none)"),
          author: await ask("  Author", defaults.author || "(none)"),
          license: await ask("  License", defaults.license),
        };
        if (details.description === "(none)") details.description = "";
        if (details.author === "(none)") details.author = "";
      } finally { terminal.close(); }
    }
    const configPath = await initializeProject(directory, details);
    process.stdout.write(`\nCreated Cove project: ${configPath}\n`);
    process.stdout.write(`  Name: ${details.name}\n  Version: ${details.version}\n  License: ${details.license}\n\n`);
    process.stdout.write(`Next steps:\n  cd ${directory}\n  cove build\n  cove run\n`);
  } else if (command === "ir" || command === "opt" || command === "cfg") {
    if (!input) throw new ProjectConfigError(`Expected a .cove source file for '${command}'.`);
    await runSingleFile(command, input);
  } else if (["check", "build", "run", "targets", "clean"].includes(command)) {
    const project = await loadProjectFromOption();
    let isFile = false;
    if (input?.endsWith(".cove")) {
      try { isFile = (await stat(resolve(input))).isFile(); } catch { isFile = false; }
    }
    if (isFile && command !== "targets" && command !== "clean") {
      await runSingleFile(command, input!);
    } else if (project) {
      if (command === "targets") {
        for (const [name, target] of Object.entries(project.config.targets)) {
          const marker = name === project.config.defaultTarget ? " (default)" : "";
          process.stdout.write(`${name}${marker}\t${target.type}\t${target.output}\n`);
        }
      } else if (command === "clean") {
        const buildPath = resolve(project.root, project.config.paths.build);
        await rm(buildPath, { recursive: true, force: true });
        process.stdout.write(`Cleaned ${buildPath}\n`);
      } else if (command === "check") {
        if (!await checkProject(project, input)) process.exitCode = 1;
      } else await buildProject(project, input, command === "run");
    } else if (command === "clean") {
      throw new ProjectConfigError("No cove.json found. Use --project <directory|cove.json>.");
    } else if (input) {
      throw new ProjectConfigError(`Could not find a project for target '${input}'. Pass a .cove file or run this command inside a Cove project.`);
    } else {
      throw new ProjectConfigError(`No cove.json found. Run 'cove init' or pass a .cove file.`);
    }
  } else usage();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
