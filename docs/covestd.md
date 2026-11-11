# CoveSTD and demand-driven runtime

CoveSTD is designed as a modular standard runtime, not a monolithic blob copied into every generated program.

## Build-time selection

Runtime requirements are discovered from the final optimized IR, after constant folding and dead-code elimination. This is intentional: if an optimization removes the only use of a runtime component, that component should not be emitted.

The runtime registry resolves component dependencies and emits their C headers and implementation fragments in dependency order. Each generated C translation unit is analyzed independently, so a helper is emitted only in translation units that use it.

## Current implementation

The initial registry contains:

| Component / feature | Generated requirements |
|---|---|
| Arithmetic and control flow | No Cove runtime |
| `print(...)` | `<stdio.h>` |
| Dynamic String concatenation | `cove_concat`, `<stdlib.h>`, `<string.h>` |
| Boolean C types | `<stdbool.h>` |

The `print` operation currently lowers directly to `printf`; it is not yet a CoveSTD runtime component. The String concatenation helper is the first Cove-owned runtime fragment registered with the component resolver.

Constant-folded string concatenation does not require the helper. For example, `"hello" + " world"` can be folded to a single literal, while concatenating runtime String parameters requires `cove_concat`.

## Future component model

Future standard-library facilities should register independently selectable components, for example:

- `json.parse`
- `json.stringify`
- `io.file.read`
- `io.file.write`
- `collections.vector`
- `collections.map`
- `closures.environment`

Components may depend on other components. The resolver should include the transitive dependency closure exactly once and in dependency order.

A component should not be linked merely because its module was imported. It should be included when generated code actually references its implementation. If a module import contributes declarations only, it should not pull implementation code into the executable.

## Design constraints

- No monolithic runtime source file in every output.
- No runtime component for pure language constructs that can be emitted directly as C.
- Runtime selection happens after optimization.
- Dependencies are explicit and deterministic.
- Generated C remains readable and valid C11.
- Runtime components should be independently testable.
- Static/shared library builds should include only components required by their compiled objects.

The current implementation is a foundation, not the completed CoveSTD. JSON, classes, closures, collections, file IO, and other planned facilities are not implemented by this change.


## Initial string allocation policy (Milestone 14)

The first `core.string.concat` implementation used `malloc` without recording the allocation. That was not an acceptable long-term behavior. It now depends on `core.memory.process-arena`, which tracks each concatenation allocation and registers a single `atexit` cleanup handler. The handler frees both string buffers and tracking nodes when the process exits. Allocation or tracking failure aborts rather than returning a null string that could later be passed to `%s`.

This is an **interim process-lifetime allocation policy**, not the final Cove ownership implementation. Concatenated strings remain valid for the lifetime of the process, including when returned from a function, but memory is not reclaimed at lexical scope exit. The registry is currently single-threaded and is not safe for concurrent allocation from multiple threads. Later ownership-aware IR will replace this arena with explicit transfer/drop operations and appropriate scope cleanup.

The runtime resolver now validates dependency cycles and emits each reachable component once, in dependency order. `core.string.concat` transitively requests `core.memory.process-arena`; arithmetic-only, print-only, and bool-only programs do not request either component.

The integration suite compiles generated C independently with GCC (`-std=c11 -Wall -Wextra -Wpedantic`), executes the resulting programs, and checks both required and forbidden runtime includes/fragments.
