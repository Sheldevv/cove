# Cove projects (Milestone 11)

Cove project configuration lives in `cove.json`. Run `cove init` to create a starter project.

```json
{
  "$schema": "https://cove-lang.org/schemas/project.schema.json",
  "project": { "name": "hello-cove", "version": "0.1.0" },
  "defaultTarget": "app",
  "paths": {
    "source": ["src"],
    "modules": ["src", "modules"],
    "include": ["include"],
    "build": "build"
  },
  "compiler": {
    "c": "auto",
    "standard": "c11",
    "optimization": "O2",
    "flags": [],
    "linkerFlags": []
  },
  "targets": {
    "app": {
      "type": "executable",
      "entry": "src/main.cove",
      "sources": ["src/**/*.cove"],
      "output": "hello-cove"
    }
  }
}
```

All source, include, module, build, and output paths are interpreted relative to the project root unless absolute. `sources` and `cSources` accept explicit paths or glob patterns. The initial glob implementation supports `*`, `?`, and recursive `**`; it skips `node_modules`, `.git`, `build`, and `dist` directories.

## Commands

- `cove init [directory] [--name name]` creates a starter project and refuses to overwrite an existing `cove.json`.
- `cove targets` lists targets and marks the default.
- `cove check [target]` discovers and frontend-checks every Cove source in the selected target.
- `cove build [target]` builds the default or named target.
- `cove run [target]` builds and executes an executable target.
- `cove clean` removes the configured build directory.
- `--project directory-or-cove.json` selects a project explicitly. Otherwise, Cove searches the current directory and its parents.

The single-file workflow remains available: `cove build hello.cove -o hello`.

## Current implementation boundaries

The project system resolves Cove imports and builds a dependency graph. Project checking combines the resolved Cove modules for semantic analysis; native builds generate C translation units and headers, compile configured native C sources, and support executable, object, static-library, and shared-library targets.

The current generated C header interface exposes function declarations. Full C header parsing, complete export/visibility controls, a stable ownership-aware Cove/C ABI, platform-specific packaging beyond the tested environment, and dependency-aware incremental compilation are not implemented yet. See the Milestone 13 section below for the native-target configuration details.

## Interactive project initialization

Run `cove init [directory]` in an interactive terminal to launch the project initializer. It asks for the project name, version, description, author, and license; press Enter to accept each default. Use `--yes` (or `-y`) for non-interactive initialization, and use `--name`, `--version`, `--description`, `--author`, and `--license` to supply metadata explicitly.

Example:

```sh
cove init my-game
```

For automation:

```sh
cove init my-game --yes --name my-game --author "Cove Developer" --license MIT
```

The generated `cove.json` stores metadata under `project`.


## Installing the compiler

Install Cove globally with `npm install --global @sheldev/cove-compiler`. This provides
the `cove` command, which discovers `cove.json` from the current directory or
its parents. A generated Cove project is independent of npm: it does not need
a `package.json` or local compiler dependency.


## Multi-file modules (Milestone 12)

A project target can include multiple `.cove` files using a glob:

```json
{
  "targets": {
    "app": {
      "type": "executable",
      "entry": "src/main.cove",
      "sources": ["src/**/*.cove"],
      "output": "my-app"
    }
  }
}
```

Use a module import to declare dependencies:

```cove
import math;
import utils.strings;

fun main() {
    print(add(20, 22));
}
```

A dotted module name maps to a path below one of `paths.modules`, with `.cove` appended. For example, `utils.strings` resolves to `utils/strings.cove`. Imports establish the project dependency graph; functions are visible across the combined semantic-analysis input. Unresolved imports and dependency cycles are errors.

For native builds, Cove analyzes the resolved graph and partitions generated function bodies into per-module C translation units with generated headers. Configured native C sources are compiled as additional inputs. Explicit export/private visibility, selective imports, alias-qualified names, and a stable ownership-aware C ABI are not implemented yet.

## Quiet mode

`-q` and `--quiet` suppress successful status messages for `check`, `build`, and `run`. Diagnostics remain on stderr, and a program's own output remains visible:

```sh
cove run --quiet
cove build -q
```

## Native targets and C interoperability

Project targets may use `executable`, `object`, `static`, or `shared`. The native backend emits a C translation unit and generated header per Cove module, compiles Cove and configured C sources to object files, and links executable/shared/static outputs. On Linux, shared targets use `.so`; static targets use `ar` and `.a`. Object targets place per-source object files under `build/obj`.

Configure native search paths and libraries in `compiler` or per target:

```json
{
  "compiler": {
    "includeDirs": ["native/include"],
    "libraryDirs": ["native/lib"],
    "libraries": ["raylib", "m"]
  },
  "targets": {
    "app": {
      "type": "executable",
      "entry": "src/main.cove",
      "sources": ["src/**/*.cove"],
      "cSources": ["native/**/*.c"],
      "libraries": ["raylib"]
    }
  }
}
```

C headers can be requested in Cove source with `import "stdio.h";` or `import <stdlib.h>;`. These become C preprocessor includes in the generated translation unit. Configure non-system header locations with `compiler.includeDirs` or `targets.<name>.includeDirs`. Native libraries are linked with `-l` names from `libraries`; directories use `-L`.

The native backend uses a shared project IR analysis pass and partitions generated function bodies into module translation units. Generated headers currently expose function declarations. A complete `.cove.h` parser, explicit export visibility, C ABI type restrictions, platform-specific packaging beyond the tested environment, and dependency-aware incremental compilation remain future work. Cove string/ownership ABI is not yet a stable public C ABI.
