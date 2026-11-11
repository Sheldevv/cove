# Cove Data Model and JSON Specification

Status: accepted language design; implementation is staged and must not be advertised as available until the corresponding compiler/runtime tests pass.

## Design goals

- Preserve C-like performance and predictable layouts for statically typed data.
- Keep dynamic behavior explicit and opt-in.
- Integrate collection ownership with Cove's ownership/borrowing model.
- Keep CoveSTD demand-driven: an executable only receives runtime components it actually uses.
- Keep JSON as a standard-library module, not a language keyword or compiler intrinsic API.

## 1. Arrays

Arrays are homogeneous ordered collections. Both type spellings are supported:

```cove
let scores: Array<Int> = [10, 20, 30];
let scores: Int[] = [10, 20, 30];
```

`Array<T>` is the canonical spelling in diagnostics, documentation, and generated type metadata. `T[]` is an equivalent convenience spelling. Nested arrays are supported by the type grammar, e.g. `Array<Array<Int>>` and `Int[][]`.

Array literals use square brackets. Indexing is zero-based. The collection API is planned around `length`, `push`, `pop`, `insert`, `removeAt`, `contains`, `indexOf`, `slice`, `clear`, and iteration. Index operations must be bounds-checked in safe Cove code; an explicit unsafe escape hatch may be considered later, but unchecked access is not the default.

Dynamic arrays grow automatically when capacity is exhausted. Users may provide an initial capacity and optional maximum capacity. The default growth strategy is geometric (normally doubling), but the exact growth factor is an implementation detail and is not part of the language ABI guarantee. A maximum-capacity failure must be reported safely; it must never write past the allocation.

The language supports both ordered removal (`removeAt`, which shifts following elements) and unordered removal (`removeAtSwap`, which replaces the removed element with the last element). `pop()` returns `Option<T>`; `popOrNull()` is the nullable convenience API once nullable types are implemented. Capacity controls include `reserve`, `shrinkToFit`, and `clear`.

Slices use half-open ranges by default. `array[start..end]` creates a non-owning view; `copySlice(start..end)` creates an independent owned array. Views track the source lifetime and obey borrowing rules. A mutable view requires an exclusive mutable borrow.

### Mutability and `const`

`const` makes the binding immutable: it cannot be reassigned. It does not automatically deep-freeze the referenced object or collection; mutation through a separate mutable owner/reference is governed by ownership and borrowing. `let` is block-scoped and mutable; `var` is function-scoped and mutable. These JavaScript-inspired scope and binding rules must be enforced by semantic analysis.

A read-only view may be added later for APIs that need to borrow immutable access without copying. Mutability must be enforced by semantic analysis, not merely by emitting C `const` qualifiers.

## 2. Maps

The canonical type is `Map<K, V>`. Map literals use colon entries:

```cove
let scores: Map<String, Int> = [
    "Sheldi": 100,
    "Alex": 80,
];
```

Duplicate keys replace the prior value. Keys must implement the hash/equality requirements of the selected map implementation. The initial built-in key set is strings, booleans, and integer types; user-defined key support requires an explicit hash/equality contract.

`Map<K, V>` is insertion-ordered. Updating an existing key does not change its position; removing and reinserting a key places it at the end. `HashMap<K, V>` is the explicitly unordered alternative intended for lookup-heavy workloads. Iteration order of `HashMap` is unspecified and must never be relied upon.

Lookup is safe by default: `get(key)` returns `V?`, not an arbitrary default value. `getOrDefault(key, fallback)` is a convenience operation. Indexing reads must have the same safe missing-key behavior; the exact optional/result surface must be finalized alongside nullable types. Assignment through an index inserts or updates.

## 3. Typed and dynamic objects

Cove has two deliberately distinct object models.

### Statically typed objects

`struct` and `class` declarations define compile-time-known fields. Unknown fields are compile errors. Field types and layouts are statically known, and the backend lowers them to C structs plus generated functions.

```cove
struct Vector2 {
    x: Float;
    y: Float;
}

class Player {
    let name: String;
    var health: Int;

    fun damage(amount: Int) {
        health -= amount;
    }
}

let position = Vector2 { x: 10.0f, y: 20.0f };
```

Classes retain Cove's previously accepted hybrid design: Kotlin-inspired declarations, C-like representation, interfaces rather than traditional class inheritance, and ownership/borrowing-aware lifetime semantics. The precise value/reference and identity semantics must be made explicit before class code generation is finalized. This specification does not silently decide that all class values are heap allocated.

### Dynamic objects

Dynamic objects are opt-in and use a runtime representation. Their properties may be added, updated, or removed at runtime, and property values use a tagged dynamic value type. They are not the default representation for `struct` or `class`.

```cove
let metadata = object {
    name: "Cove",
    version: 1,
};
metadata.status = "experimental";
```

Dynamic objects require runtime property lookup and runtime type checks. They therefore carry a performance and memory cost absent from typed structs/classes. The implementation must make that cost explicit and must not lower ordinary typed objects through this dynamic representation.

## 4. JSON module

JSON is a standard library module:

```cove
import json;
```

The public value model is a tagged `JsonValue` with variants for null, boolean, number, string, array, and object. `JsonArray` is ordered. `JsonObject` is a JSON-specific string-keyed object; it is not interchangeable with a general Cove `Map` or a dynamic object, even if internal storage is shared.

Initial API shape:

```cove
let value = json.parse(input);
let text = json.stringify(value);
let pretty = json.stringifyPretty(value);
```

Parsing and serialization return explicit errors. They must not silently coerce incompatible values or crash on malformed input. The concrete error type will use Cove's `Result<T, E>` design when that core type is implemented; until then the API must not pretend an unchecked nullable return is sufficient error reporting.

Typed conversion is planned:

```cove
let player = json.decode<Player>(input);
let output = json.encode(player);
```

Typed encode/decode should use compiler-generated field access and validation rather than requiring general runtime reflection. Struct/class types must opt in through a serializable contract or supported derive mechanism. Private fields and unsupported field types must produce clear diagnostics or serialization errors.

`JsonObject` construction should use JSON-specific builder syntax/API. It must not be conflated with the general `object {}` dynamic-object expression.

## 5. C representation and runtime

| Cove concept | Intended representation |
|---|---|
| Owned `Array<T>` | typed pointer + length + capacity |
| Shared `Array<T>` | reference-counted allocation/control block |
| Borrowed array/view | typed pointer + length + tracked lifetime |
| Fixed-size array | inline storage where practical |
| Array slice | pointer + length + tracked source lifetime |
| `Map<K,V>` | insertion-ordered hash table |
| `HashMap<K,V>` | unordered hash table |
| `struct` | native C struct |
| `class` | C struct + generated methods/lifetime support |
| dynamic `object` | tagged dynamic values + property table |
| `JsonValue` | tagged union |
| `JsonArray` | dynamic array of `JsonValue` |
| `JsonObject` | string-keyed JSON property table |

Runtime components are registered independently and resolved from optimized IR. Array use must not pull in map or JSON support. Map use must not pull in the JSON parser. `json.parse` must not pull in the serializer unless the program also serializes. Typed serializers should be generated per participating type. No full CoveSTD bundle is linked merely because one standard-library function is used.

All allocation, destruction, moves, and borrows must be integrated with Cove's ownership model. The current process-lifetime string arena is an interim implementation and is not a sufficient final lifetime strategy for collections or objects.

## 6. Implementation gates

The feature is not complete until all applicable gates pass:

1. Lexer/parser tests for declarations, literals, nested generic types, indexing, field access, and iteration syntax.
2. Semantic tests for element/key/value types, unknown fields, invalid keys, deep const mutation, and null-safe lookup.
3. IR tests for allocation, element access, mutation, iteration, and cleanup operations.
4. C backend tests compiling generated C independently with GCC and Clang where available.
5. Runtime tests for empty collections, growth, collisions, duplicate keys, ordering, bounds errors, and cleanup.
6. JSON conformance tests for escaping, Unicode, number parsing, malformed input, nested arrays/objects, and round trips.
7. Ownership tests for moves, borrows, nested collections, and destruction on all control-flow exits.
8. Binary-size tests proving unused runtime components are omitted.

## 7. Non-goals for the first collection implementation

- No implicit conversion between dynamic objects, `JsonObject`, and `Map<String, JsonValue>`.
- No implicit heterogeneous arrays.
- No promise that hash-map iteration is stable.
- No runtime reflection requirement for typed JSON serialization.
- No unchecked indexing in safe code.


## 8. Accepted array API decisions (design complete; implementation staged)

The following API and behavior decisions are accepted:

- Both `Array<T>` and `T[]` spellings.
- Automatically growing dynamic arrays, optional initial capacity, and optional maximum capacity.
- Ordered `removeAt` and swap-based `removeAtSwap`.
- `pop()` returns `Option<T>`; `popOrNull()` returns `T?` after nullable types are implemented.
- Slices are views by default; `copySlice` explicitly copies.
- Nested arrays and contiguous multidimensional `Matrix<T>` are both supported design goals.
- Traditional loops and functional operations (`forEach`, `map`, `filter`, `reduce`, `find`, `any`, `all`, etc.).
- Mutability follows ownership and borrowing: shared `&Array<T>` is read-only, exclusive `&mut Array<T>` can mutate.
- Built-in ascending/descending sorting and custom comparator/key-based sorting. Stable sorting is available where requested or selected by the API contract.
- Value-based and predicate-based searching. Missing matches use `Option`/nullable results, not sentinel indices.
- Automatic capacity management plus `reserve`, `shrinkToFit`, and `clear`.
- Hybrid storage: owned arrays use pointer/length/capacity; shared arrays use reference-counted storage; borrowed arrays use pointer/length; fixed-size arrays use inline storage where practical; slices use pointer/length plus lifetime tracking.

The design does not imply that these APIs are already implemented. In particular, current Milestone 16 only supports fixed-size array views, indexed reads, varargs, and postfix iteration.
