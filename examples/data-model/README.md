# Data model examples

These snippets document the accepted Cove data-model direction. The executable
array example demonstrates the current Milestone 17 dynamic-array API. The
remaining maps, objects, and JSON snippets are design fixtures, not claims that
their full features are implemented. A feature is available only after the
parser, semantic analyzer, IR, C backend, and runtime support it.

## Arrays

The current compiler supports `Array<T>` / `T[]`, array literals, checked
indexing, indexed assignment, `push`, `.length`, `.capacity`, `reserve`,
`shrinkToFit`, and `clear`. Owned arrays use explicit moves and deterministic
cleanup; borrowed parameters detach before allocation-changing mutation.

Run the executable example with:

```sh
cove run examples/data-model/arrays.cove
```

The separate `vararg-array-sum.cove` example demonstrates borrowed vararg
arrays and postfix iteration. Removal, pop/Option, nullable types, slices,
shared ownership, and generic element destruction are still in development.

## Ordered and unordered maps

```cove
let ordered: Map<String, Int> = ["first": 1, "second": 2];
let fast: HashMap<String, Int> = ["first": 1, "second": 2];
let maybeValue: Int? = ordered.get("first");
```

## Typed and dynamic objects

```cove
struct Point { x: Float; y: Float; }
let point = Point { x: 1.0f, y: 2.0f };

let metadata = object { name: "Cove", version: 1 };
metadata.status = "in development";
```

## JSON

```cove
import json;
let value = json.parse("{\\"name\\":\\"Cove\\"}");
let output = json.stringifyPretty(value);
```
