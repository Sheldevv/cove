# Cove

Cove is an early-stage C-superset language. The compiler checks Cove source,
lowers it through a typed intermediate representation, emits readable C, and
uses GCC or Clang to build native programs.

> **Status:** experimental, pre-1.0 software. The supported language is a
> deliberately limited subset; see [Current implementation](#current-implementation)
> and the milestone notes before relying on a feature.

## Requirements

- Node.js 20 or newer
- GCC or Clang for native `build` and `run` commands
- A native toolchain available on `PATH` for the selected target

## Install

```sh
npm install --global @sheldev/cove-compiler
cove --version
cove --help
```

Create and run a project:

```sh
cove init hello-world
cd hello-world
cove check
cove build
cove run
```

Or compile a single source file directly:

```sh
cove check examples/hello.cove
cove build examples/hello.cove -o hello
cove run examples/hello.cove
```

Cove projects use `cove.json`; a generated project does not need its own
`package.json` or a local installation of the Cove compiler. See
[Project configuration](docs/projects.md).

## Current implementation

The compiler currently includes:

- A lexer, parser, source positions, and structured diagnostics.
- Semantic analysis, typed frontend metadata, and explicit IR lowering.
- Control-flow graph analysis, SSA construction/validation, and conservative IR
  optimizations.
- Initial move checking for `String` and call-scoped borrow-conflict checks.
- Project discovery, target configuration, module dependency resolution, and
  native build commands.
- C code generation and native executable, object, static-library, and
  shared-library build paths.
- A demand-driven C runtime foundation for printing, string concatenation, and
  checked array indexing.
- A language server (`cove lsp`) with diagnostics and basic keyword completion.

The implemented source subset includes functions, typed and generic parameters,
`let` bindings, return expressions, conditionals, `while` loops, expressions,
assignments, `Array<T>` / `T[]` types, array literals and checked indexing,
`vararg<T>` parameters, and postfix array iteration. See the examples and
[milestone 16 notes](docs/milestone-16.md).

### Arrays today

The current array implementation is a **fixed-size, non-owning pointer/length
view**. It supports array literals, checked indexed reads, vararg packing, and
postfix iteration. It does not yet provide dynamic growth, `push`/`pop`, general
element mutation, slices, or collection ownership. The broader array API in the
specifications is a design target, not an implemented feature.

### Ownership and runtime limitations

Ownership and borrowing are foundations, not a complete borrow checker or
destructor system. `String` move checking and call-scoped borrow checks are
implemented, but full lifetime checking, automatic lexical-scope cleanup,
user-defined destructors, and a stable public C ABI are not yet available.
String concatenation allocations are tracked by a generated process-lifetime
arena and released at process exit; this is an interim, single-threaded policy.

### Project and native-build limitations

Project builds resolve Cove modules and compile configured native C sources.
Resolved Cove modules are currently combined for analysis and emitted through
the project backend's generated translation units. The C header generator
currently exposes function declarations; full C header parsing, complete
export/visibility controls, stable ownership-aware ABI rules, and
platform-specific packaging beyond the tested environment remain future work.
Incremental dependency-aware compilation is also not implemented.

## Useful commands

```sh
cove check                 # Check the current project
cove build                 # Build its default target
cove run                   # Build and run its default executable target
cove targets               # List project targets
cove clean                 # Remove the configured build directory
cove ir file.cove          # Print lowered IR
cove opt file.cove         # Print optimized IR and SSA information
cove cfg file.cove         # Inspect control-flow and SSA validation
cove lsp                   # Start the language server over stdio
```

Use `--project path` to select a project explicitly and `-q` / `--quiet` to
suppress successful status messages. Diagnostics and program output remain
visible.

## Build Cove from source

```sh
npm install
npm run build
npm test
npm run dev -- check examples/hello.cove
npm run dev -- run examples/hello.cove
```

`npm run dev` executes the TypeScript source directly. The published CLI runs
the compiled files in `dist/`.

## Documentation

- [Architecture](docs/architecture.md)
- [Projects and native targets](docs/projects.md)
- [Ownership](docs/ownership.md) and [borrowing](docs/borrowing.md)
- [C compatibility](docs/c-compatibility.md)
- [CoveSTD runtime](docs/covestd.md)
- [Language server](docs/lsp.md)
- [Implementation milestones](docs/milestones.md)
- [Array runtime design](docs/specs/array-runtime-design.md)
- [Data model design](docs/specs/data-model.md)

## Contributing

Cove is experimental and evolving. When reporting a bug, include the Cove
source, the command used, the compiler version, and the generated C or complete
diagnostic when possible. Tests can be run with `npm test`.

Cove is distributed under the MIT License; see [LICENSE](LICENSE).
