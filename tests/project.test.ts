import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateProjectConfig, loadProjectConfig, ProjectConfigError } from "../src/project/config.js";
import { discoverTargetSources, findProjectConfig } from "../src/project/discovery.js";
import { initializeProject } from "../src/project/init.js";
import { buildModuleGraph, combineProjectSources } from "../src/project/modules.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "cove-project-test-"));
}

test("validates project configuration and supplies optional defaults", () => {
  const config = validateProjectConfig({
    project: { name: "sample" },
    targets: { app: { type: "executable", entry: "src/main.cove" } },
  });
  assert.equal(config.project.name, "sample");
  assert.equal(config.defaultTarget, "app");
  assert.deepEqual(config.targets.app?.sources, ["src/main.cove"]);
  assert.equal(config.compiler.standard, "c11");
});

test("rejects invalid target types and missing default targets", () => {
  assert.throws(() => validateProjectConfig({
    project: { name: "sample" },
    targets: { app: { type: "wat", sources: ["main.cove"] } },
  }), ProjectConfigError);
  assert.throws(() => validateProjectConfig({
    project: { name: "sample" }, defaultTarget: "missing",
    targets: { app: { type: "executable", sources: ["main.cove"] } },
  }), /defaultTarget 'missing' does not exist/);
});

test("finds cove.json in the current directory or a parent", async () => {
  const root = await temporaryDirectory();
  try {
    await mkdir(resolve(root, "nested", "deeper"), { recursive: true });
    await writeFile(resolve(root, "cove.json"), JSON.stringify({ project: { name: "x" }, targets: { app: { type: "executable", sources: ["main.cove"] } } }));
    assert.equal(await findProjectConfig(resolve(root, "nested", "deeper")), resolve(root, "cove.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("expands recursive Cove source globs and validates the entry", async () => {
  const root = await temporaryDirectory();
  try {
    await mkdir(resolve(root, "src", "math"), { recursive: true });
    await writeFile(resolve(root, "cove.json"), JSON.stringify({
      project: { name: "sample" },
      targets: { app: { type: "executable", entry: "src/main.cove", sources: ["src/**/*.cove"] } },
    }));
    await writeFile(resolve(root, "src", "main.cove"), "fun main() {}\n");
    await writeFile(resolve(root, "src", "math", "add.cove"), "fun add() {}\n");
    const project = await loadProjectConfig(resolve(root, "cove.json"));
    const sources = await discoverTargetSources(project, project.config.targets.app!);
    assert.deepEqual(sources.cove.map((path) => path.slice(root.length + 1).replaceAll("\\", "/")), ["src/main.cove", "src/math/add.cove"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cove init creates a starter project without overwriting existing projects", async () => {
  const root = await temporaryDirectory();
  try {
    const configPath = await initializeProject(root, "hello-cove");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { project: { name: string; author?: string; license?: string }; defaultTarget: string };
    assert.equal(config.project.name, "hello-cove");
    assert.equal(config.defaultTarget, "app");
    assert.match(await readFile(resolve(root, "src", "main.cove"), "utf8"), /Hello, Cove/);
    await assert.rejects(() => initializeProject(root), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("project initializer persists author, description, version, and license metadata", async () => {
  const root = await temporaryDirectory();
  try {
    const configPath = await initializeProject(root, { name: "metadata-app", version: "1.2.3", description: "A Cove app", author: "Cove Dev", license: "MIT" });
    const config = JSON.parse(await readFile(configPath, "utf8")) as { project: Record<string, string> };
    assert.deepEqual(config.project, { name: "metadata-app", version: "1.2.3", description: "A Cove app", author: "Cove Dev", license: "MIT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("resolves project imports and builds dependency-first module order", async () => {
  const root = await temporaryDirectory();
  try {
    await mkdir(resolve(root, "src", "utils"), { recursive: true });
    await writeFile(resolve(root, "cove.json"), JSON.stringify({
      project: { name: "modules" },
      paths: { modules: ["src"] },
      targets: { app: { type: "executable", entry: "src/main.cove", sources: ["src/**/*.cove"] } },
    }));
    await writeFile(resolve(root, "src", "main.cove"), 'import utils.math;\nfun main() { print(add(20, 22)); }\n');
    await writeFile(resolve(root, "src", "utils", "math.cove"), 'fun add(a: Int, b: Int): Int { a + b }\n');
    const project = await loadProjectConfig(resolve(root, "cove.json"));
    const sources = await discoverTargetSources(project, project.config.targets.app!);
    const graph = await buildModuleGraph(project, sources);
    assert.equal(graph.order.length, 2);
    assert.equal(graph.order[0], resolve(root, "src", "utils", "math.cove"));
    const combined = await combineProjectSources(project, graph, resolve(root, "src", "main.cove"));
    assert.match(combined.text, /fun add/);
    assert.match(combined.text, /fun main/);
    assert.doesNotMatch(combined.text, /^\s*import\s/m);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("detects circular project module imports", async () => {
  const root = await temporaryDirectory();
  try {
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "cove.json"), JSON.stringify({
      project: { name: "cycle" },
      paths: { modules: ["src"] },
      targets: { app: { type: "executable", entry: "src/main.cove", sources: ["src/**/*.cove"] } },
    }));
    await writeFile(resolve(root, "src", "main.cove"), "import other;\nfun main() {}\n");
    await writeFile(resolve(root, "src", "other.cove"), "import main;\nfun helper() {}\n");
    const project = await loadProjectConfig(resolve(root, "cove.json"));
    const sources = await discoverTargetSources(project, project.config.targets.app!);
    await assert.rejects(buildModuleGraph(project, sources), /Circular module dependency/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("collects native C header imports without treating them as Cove modules", async () => {
  const root = await temporaryDirectory();
  try {
    await mkdir(resolve(root, "src"), { recursive: true });
    await writeFile(resolve(root, "cove.json"), JSON.stringify({
      project: { name: "native-imports" },
      paths: { modules: ["src"] },
      targets: { app: { type: "executable", entry: "src/main.cove", sources: ["src/**/*.cove"] } },
    }));
    await writeFile(resolve(root, "src", "main.cove"), 'import "stdio.h";\nimport <stdlib.h>;\nfun main() {}\n');
    const project = await loadProjectConfig(resolve(root, "cove.json"));
    const sources = await discoverTargetSources(project, project.config.targets.app!);
    const graph = await buildModuleGraph(project, sources);
    assert.deepEqual(graph.nativeHeaders.get(resolve(root, "src", "main.cove")), ["stdio.h", "<stdlib.h>"]);
    const combined = await combineProjectSources(project, graph);
    assert.doesNotMatch(combined.text, /^\\s*import\\s/m);
  } finally { await rm(root, { recursive: true, force: true }); }
});
