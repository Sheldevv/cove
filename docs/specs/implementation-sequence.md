# Data model implementation sequence

The data-model design is accepted, but implementation is incremental. Do not mark a feature available until its parser, semantic, IR, C backend, and runtime tests pass.

1. **Type-system foundation:** structured generic type representation, canonical array spelling, const-qualified bindings, struct declarations and field checking.
2. **Dynamic array runtime (Milestone 17):** mutable owned array representation, literals that allocate owned storage, automatic growth, `length`, `push`, indexed reads/writes, bounds checks, and deterministic cleanup hooks. Preserve borrowed array views for varargs and C interop.
3. **Array API completion:** `pop`/`Option`, `popOrNull`/nullable types, ordered and swap removal, slices and copies, configurable initial/maximum capacities, nested arrays, contiguous matrices, iteration methods, searching and sorting. `reserve`, `shrinkToFit`, and `clear` are part of the Milestone 17 initial implementation. Higher-order methods depend on function values/lambdas.
4. **Ownership integration:** moves, shared reference counting, borrowed views, mutable slice exclusivity, destruction on all exits, and failure paths.
5. **Map vertical slice:** insertion-ordered `Map`, unordered `HashMap`, colon literals, key constraints, nullable lookup, iteration and runtime tests.
6. **Typed object completion:** class/struct construction, field access, method lowering, visibility and ownership semantics.
7. **Dynamic object runtime:** explicit `object {}` expressions and tagged property storage.
8. **JSON value model:** `JsonValue`, `JsonArray`, `JsonObject`, parser, serializer, errors and conformance suite.
9. **Typed JSON conversion:** generated serializers/deserializers for opted-in Cove types.
10. **Runtime minimization:** verify component-level linking and binary sizes at every stage.

Every stage must add tests and preserve the existing test suite. A stage is complete only when generated C compiles and runs, not merely when `cove check` accepts syntax.
