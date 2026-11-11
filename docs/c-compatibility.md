# C compatibility roadmap

Cove's goal is one-way source compatibility: valid C programs should be usable in Cove projects, while Cove-only syntax does not need to compile as C. This document describes the current prototype, not a claim that the compiler implements all of C.

## Implemented in this slice

- C-style function definitions using one-token built-in types, such as `int add(int left, int right) { ... }`.
- C's `(void)` spelling for a no-parameter function definition.
- `f` / `F` suffixes on decimal floating-point literals, inferred as Cove `Float`.
- The C backend emits an `f` suffix for Float constants.

## Not implemented yet

- Full C declarations (pointer, array, function-pointer, qualifier, typedef, struct/union/enum, and multiword integer types).
- C preprocessor directives and arbitrary C header parsing in `.cove` files.
- Exact C integer widths and C ABI preservation. The current semantic type `Int` is emitted as `long long`, including for the current simple C-style `int` declaration syntax. Do not use this slice for cross-language ABI declarations yet.
- Compiling and linking arbitrary `.c` translation units alongside Cove-generated C.
- Full C expression and statement grammar.

The next compatibility milestone should introduce distinct C ABI types (`char`, `short`, `int`, `long`, `long long`, `size_t`, pointers, and qualifiers), then add native `.c` source inputs and header-backed external declarations.
