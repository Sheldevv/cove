# Cove dynamic array runtime design

Status: design accepted. The Milestone 16 compiler still implements fixed-size array views; this document specifies the next implementation work and must not be read as a claim that the APIs already compile.

## Goals

- Keep ordinary `Array<T>` convenient and dynamically growing.
- Keep element storage contiguous and typed in generated C.
- Preserve C interop and borrowed views without forcing reference counting on every array.
- Make allocation, moves, borrows, and destruction obey Cove ownership rules.
- Emit only array runtime components actually required by optimized IR.

## Public surface

```cove
let values: Array<Int> = [];
let reserved = Array<Int>(capacity: 128);
let bounded = Array<Int>(capacity: 32, maxCapacity: 256);

values.push(10);
values.push(20);
print(values.length);
values[0] = 42;
values.removeAt(0);
values.removeAtSwap(0);
values.reserve(128);
values.shrinkToFit();
values.clear();

let view = values[1..4];
let independent = values.copySlice(1..4);
```

`pop()` returns `Option<T>`. `popOrNull()` returns `T?`. Those two signatures are accepted, but implementation is gated on the `Option` and nullable type foundations; do not temporarily substitute a sentinel value.

## Storage families

1. **Owned dynamic array:** `{ T *data; size_t length; size_t capacity; }`. It owns the allocation and is destroyed exactly once.
2. **Shared array:** a handle to a reference-counted control block containing the allocation metadata. Copies retain; destruction releases. This representation is selected only for variables explicitly declared `shared` or for APIs whose contract requires shared ownership.
3. **Borrowed view:** `{ const T *data; size_t length; }` for shared/read-only borrowing, or `T *data` for exclusive mutable borrowing. It never frees the source allocation.
4. **Fixed-size array:** inline storage where the type/size is statically known and the ABI permits it.
5. **Slice:** pointer + length plus compiler-tracked source lifetime. Mutable slices require an exclusive borrow.

The source-level `Array<T>` type does not itself imply reference counting. The variable ownership qualifier determines the ownership representation; parameter/reference types determine borrowed views.

## Growth and capacity

- Empty arrays have `length = 0`; a null data pointer is valid when capacity is zero.
- `push` grows geometrically when `length == capacity`, subject to `maxCapacity`.
- Capacity arithmetic must be overflow-checked before allocation.
- Allocation failure and maximum-capacity exhaustion use Cove's explicit error/panic policy; neither may cause an out-of-bounds write.
- `reserve(n)` guarantees capacity of at least `n` without changing length.
- `shrinkToFit()` requests capacity equal to length; it may be a no-op when the allocator cannot shrink in place.
- `clear()` destroys all live elements and sets length to zero while retaining capacity.

## Element operations

- `removeAt(i)` destroys the removed element and shifts later elements left, preserving order.
- `removeAtSwap(i)` destroys the removed element and moves the last element into its slot; order is not preserved.
- Indexing is zero-based and bounds-checked in safe Cove.
- Indexed assignment requires a mutable owner or exclusive mutable borrow.
- Element move/copy/drop behavior is derived from the element type's ownership traits; generic byte-copying is not a valid universal implementation.

## Runtime decomposition

The compiler should request only the helpers used by the optimized IR. Planned components include allocation/growth, bounds checking, element destruction/move support, shared control blocks, and slice support. A program using only a borrowed fixed-size view must not pull in the dynamic allocator or reference-counting code.

## ABI and C interoperability

The public C ABI for a Cove-owned dynamic array is not finalized. Do not expose the internal control block as a stable C ABI. C interop should initially use borrowed pointer/length views or explicitly documented opaque handles.

## Implementation gates

- Empty array and literal initialization.
- Repeated push across multiple growth boundaries.
- Correct length/capacity invariants and capacity overflow rejection.
- Read/write indexing and out-of-bounds termination.
- `removeAt` and `removeAtSwap`, including empty/first/last cases.
- Ownership cleanup under normal return, early return, and error propagation.
- Shared retain/release correctness and borrowed-view lifetime rejection.
- GCC and Clang compile/run tests with strict warnings.
- ASan/UBSan tests where supported.
- Binary-size checks proving unused runtime pieces are absent.
