# Cove implementation milestones

## Milestone 1 — Frontend foundation (prototype complete)

- [x] Token kinds, lexer, source spans, and structured diagnostics.
- [x] Initial AST and parser.
- [x] `cove check` command and frontend tests.

## Milestone 2 — Native C backend (prototype complete)

- [x] Initial function, variable, expression, and return support.
- [x] Readable C generation and GCC/Clang invocation.
- [x] `cove build` and `cove run` commands.

## Milestone 3 — Semantic analysis (foundation complete)

- [x] Name resolution, scopes, duplicate declaration checks, and type checking.
- [x] Function arity, argument, assignment, condition, operator, and return checks.
- [x] Inferred variable and function return types.
- [ ] Broader grammar coverage and richer diagnostics.

## Milestone 4 — Typed IR (complete foundation)

- [x] Typed program representation and canonical built-in types.
- [x] Type metadata for expressions, variables, parameters, and function returns.
- [x] Typed representation inspection and regression tests.

## Milestone 5 — Explicit IR lowering (prototype complete)

- [x] Backend-neutral values, operands, instructions, functions, and basic blocks.
- [x] Lowering of current typed expressions and statements.
- [x] Explicit branches and jumps for `if` and `while` control flow.
- [x] Stack slots (`alloca`, `load`, `store`) for mutable locals and parameters.
- [x] IR validation and readable `cove ir` output.
- [x] C backend consumes explicit IR without importing the AST.
- [ ] More IR operations for arrays, structs, pointers, and ownership.

## Milestone 6 — Conservative IR optimization (prototype complete)

- [x] Numeric, boolean, comparison, and string constant folding.
- [x] Same-basic-block constant propagation.
- [x] Constant-branch simplification and unreachable-block removal.
- [x] Iterative dead pure-value elimination while preserving side effects.
- [x] `cove opt` command with optimization statistics.
- [x] Native builds use optimized IR by default.
- [ ] Broader global data-flow constant propagation.
- [ ] Optimization levels (`-O0`, `-O1`, `-O2`) and benchmark suite.

## Milestone 7 — CFG analysis and SSA (prototype complete)

- [x] CFG predecessor/successor maps and reachability analysis.
- [x] Dominator sets, immediate dominators, and dominance frontiers.
- [x] Stack-slot promotion using iterated dominance frontiers.
- [x] Phi-capable IR and SSA promotion for eligible local stack slots.
- [x] Phi insertion for branch merges and loop-carried values.
- [x] SSA validation for definitions, uses, and dominance.
- [x] Phi-aware C emission using predecessor edge assignments.
- [x] Memory-aware local load forwarding.
- [x] Dominator-scoped common-subexpression elimination.
- [x] `cove cfg` command for inspecting CFG and dominance information.

## Milestone 11 — Project foundation (implemented)

- [x] JSON project manifest (`cove.json`) with validated project, path, compiler, and target settings.
- [x] JSON Schema for editor validation and completion.
- [x] Project discovery from the working directory and parent directories, plus `--project` override.
- [x] `cove init`, `cove targets`, project-aware `check`, `build`, `run`, and `clean` commands.
- [x] Explicit and recursive source glob discovery (`*`, `?`, `**`) with deterministic ordering and deduplication.
- [x] Multiple named target definitions and default target selection.
- [x] Project compiler standard, optimization, flags, and linker flags flow into native builds.
- [x] Existing single-file commands remain supported.
- [ ] Cross-file name resolution and actual multi-file compilation (Milestones 12–13).

## Future milestones

- [ ] Module syntax, resolver, dependency graph, generated headers, and separate C translation units.
- [ ] C interoperability, header imports, external declarations, native C source integration, and linker configuration.
- [ ] Static/shared library targets, incremental builds, caching, and parallel compilation.
- [ ] Complete ownership, borrowing, lifetime analysis, and deterministic cleanup.

## Milestone 9 — Ownership foundation

- Added a dedicated ownership analysis pass after type checking.
- Added the `move(value)` built-in as an explicit transfer operation for the first non-Copy type, `String`.
- Rejects use-after-move and implicit String copies.
- Allows a moved local to be reinitialized.
- Treats String parameters as borrowed and prevents moving them.
- Function calls borrow String arguments in this initial model; ownership-taking parameter annotations are not implemented yet.
- Ownership state is conservatively merged across conditional branches and loops.
- `move` lowers to the original IR value, so it introduces no runtime copy or wrapper call.
- Added `docs/ownership.md` and `examples/ownership.cove`.

Not included: `&T`/`&mut T`, borrow lifetimes, user-defined destructors, drop insertion, or a final String allocation strategy. These require cleanup-aware IR and must be implemented before claiming deterministic resource management.


## Milestone 12 — Multi-file module foundation

- Multiple `.cove` project sources are compiled together.
- `import module.name;` resolves against configured module roots.
- Dependency-first ordering and circular-import detection.
- Successful command output can be suppressed with `-q` / `--quiet`.
- Current implementation emits one combined C translation unit; separate module C files/headers are a later backend milestone.

## Milestone 13 — Native targets and compilation (initial implementation)

- Added `object` targets alongside executable, static archive, and shared library targets.
- Project Cove functions are emitted into per-module `.c` files with generated `.h` interfaces.
- Each Cove translation unit is compiled to its own object file; project C sources are compiled as native object inputs.
- Executable and shared targets link the generated objects; static targets use `ar`; object targets retain the object directory.
- Added project-level and target-level include directories, library directories, and libraries.
- Added source-level `import "header.h";` and `import <header.h>;` collection and generated C includes.
- Linux `.so` and `.a` output paths are supported by the initial backend.

Remaining interoperability work: `.cove.h` parsing and mapping, source-level external C function declarations and semantic symbol integration, public/private export controls, stable C ABI restrictions for Cove-managed types, static archive portability, Windows/macOS output handling, and incremental/parallel builds. The current module function partitioner assumes globally unique function names and currently supports the compiler's existing function syntax subset.


## Milestone 14 — CoveSTD runtime ownership and integration

- Added a dependency-aware runtime component registry with deterministic topological emission and cycle detection.
- Added `core.memory.process-arena`; string concatenation now registers allocations and frees them at process exit.
- Made `core.string.concat` depend on the process arena and removed its direct unchecked `malloc` path.
- Added a GCC integration test that compiles and executes arithmetic-only, print-only, bool-only, and concatenation programs, checking emitted headers and runtime fragments.
- Verified generated C under strict GCC warnings.
- Limitation: the process arena is an interim policy. It retains allocations until process exit and is not thread-safe; explicit ownership-aware IR and scope cleanup remain future work.

## Milestone 16 — Array views, varargs, and postfix iteration (initial vertical slice)

- Added generic `Array<T>` and equivalent `T[]` type syntax for the currently supported built-in element types.
- Added homogeneous array literals and indexed reads with compile-time element/index checks.
- Added runtime bounds checks for explicit indexing; the bounds helper is emitted only when indexed access is used.
- Added final-parameter `vararg<T>` syntax. Calls pack trailing arguments into an array view, and zero trailing arguments are allowed.
- Added postfix iteration syntax: `expression for item in collection;`.
- Lowered postfix iteration to CFG blocks and indexed loops in explicit IR.
- Added numeric `+=` assignment and GCC integration coverage for the combined array/vararg/iteration example.

This is deliberately an initial fixed-size array-view implementation, not the full dynamic collection runtime in the data-model specification. Dynamic growth, `push`/`pop`, element mutation, slices, general iterator abstractions, and ownership-aware destruction remain future work.


## Milestone 17 — Dynamic array runtime (planned; design accepted)

- Replace the current fixed-size-only `Array<T>` representation for owned arrays with typed pointer/length/capacity storage.
- Preserve borrowed array views for varargs and C interop.
- Add dynamic literal allocation, automatic geometric growth, `push`, length access, mutable indexed assignment, and checked indexed reads.
- Add capacity overflow checks and demand-driven CoveSTD allocation support.
- Integrate deterministic cleanup before advertising owned dynamic arrays as complete.
- Defer `pop`/`Option`, `popOrNull`/nullable types, slices, shared reference counting, sorting, searching, and higher-order methods to follow-up slices where their type-system dependencies are available.

Milestone 17 has not yet been implemented. The current compiler remains at the verified Milestone 16 feature set.
