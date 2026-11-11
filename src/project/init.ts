import { mkdir, writeFile, access } from "node:fs/promises";
import { basename, resolve } from "node:path";

export interface ProjectInitOptions {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly license?: string;
}

export async function initializeProject(directory = process.cwd(), optionsOrName: ProjectInitOptions | string = {}): Promise<string> {
  const root = resolve(directory);
  const options: ProjectInitOptions = typeof optionsOrName === "string" ? { name: optionsOrName } : optionsOrName;
  const name = options.name ?? basename(root);
  await mkdir(root, { recursive: true });
  const configPath = resolve(root, "cove.json");
  try {
    await access(configPath);
    throw new Error(`A Cove project already exists at ${configPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const metadata = {
    name,
    version: options.version ?? "0.1.0",
    ...(options.description ? { description: options.description } : {}),
    ...(options.author ? { author: options.author } : {}),
    ...(options.license ? { license: options.license } : {}),
  };
  const config = {
    "$schema": "https://cove-lang.org/schemas/project.schema.json",
    project: metadata,
    defaultTarget: "app",
    paths: { source: ["src"], modules: ["src", "modules"], include: ["include"], build: "build" },
    compiler: { c: "auto", standard: "c11", optimization: "O0", flags: [], linkerFlags: [] },
    targets: {
      app: { type: "executable", entry: "src/main.cove", sources: ["src/**/*.cove"], output: name },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
  await mkdir(resolve(root, "src"), { recursive: true });
  await writeFile(resolve(root, "src/main.cove"), `fun main() {\n    print("Hello, Cove!");\n}\n`, { flag: "wx" });
  const gitignorePath = resolve(root, ".gitignore");
  try { await access(gitignorePath); }
  catch { await writeFile(gitignorePath, "node_modules/\ndist/\nbuild/\n", { flag: "wx" }); }
  return configPath;
}
