# Milestone 16 — Array Views, Varargs, and Postfix Iteration

This milestone adds a first executable vertical slice for the common array/vararg workflow.

## Supported syntax

```cove
fun sum(numbers: vararg<Int>): Int {
    let total = 0;
    total += number for number in numbers;
    total
}

fun main() {
    let numbers: Array<Int> = [10, 20, 30];
    print(numbers[0]);
    print(numbers[1]);
    print(numbers[2]);
    print(sum(1, 2, 3, 4, 5));
}
```

`Int[]` is also accepted as an equivalent spelling for `Array<Int>`.

## Semantics in this milestone

- `Array<T>` is currently a fixed-size, non-owning array view represented in C as a typed pointer and length. Array literals use C compound literals; no heap allocation is required.
- Array element types are checked. Index expressions require `Int` indices and perform a runtime bounds check.
- `vararg<T>` must be the final parameter and there can be at most one per function. Calls pack trailing arguments into an array view. Zero trailing arguments are allowed.
- Vararg parameters are exposed inside the function as `Array<T>`.
- `expression for item in array;` is a postfix loop modifier. The expression is executed once per element, in order. It lowers to an indexed CFG loop and does not create a second collection.
- Numeric `+=` is supported for local variables.

## Not yet implemented

This is not the complete dynamic collection API from `docs/specs/data-model.md`. In particular, this milestone does not yet implement dynamic growth, `push`/`pop`, element mutation, general collection ownership/destruction, slices, maps, or iterators. The current array-view representation must not be treated as a stable public ABI yet.

## Verification

The milestone adds parser/type-checking tests and a GCC integration test for the complete example, plus an out-of-bounds failure test. The generated C uses a minimal `CoveIntArray` struct and only includes the bounds-check runtime when an explicit index operation is present.
