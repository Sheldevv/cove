# Milestone 17 — Dynamic arrays (implementation log)

Status: **initial vertical slice implemented; milestone remains in progress**.

## Supported now

```cove
fun inspect(values: Array<Int>): Int {
    values.reserve(128)
    values.push(99)
    values[0] = 77
    values.shrinkToFit()
    values.length
}

fun main() {
    let values: Array<Int> = []
    values.push(10)
    values.push(20)
    values[0] += 5
    print(values.length)
    print(values[0])
    print(inspect(values))
    print(values[0])
}
```

- `Array<T>` owned locals use a typed C struct with `data`, `length`,
  `capacity`, and an ownership bit.
- Array literals allocate; explicitly typed empty arrays are supported.
- `push` uses geometric capacity growth and checks size arithmetic before
  allocating/reallocating.
- `.length` and `.capacity`, checked indexed reads, indexed writes, and numeric
  indexed `+=` are lowered through explicit IR instructions.
- `reserve(n)` grows to at least `n` without changing length and rejects negative
  or overflowing capacities. `shrinkToFit()` sets logical capacity to length.
  `clear()` sets length to zero while retaining capacity.
- Owned arrays cannot be copied implicitly. `move(array)` transfers the
  allocation and clears the source slot.
- Function array parameters are borrowed views. Allocation-changing mutation
  detaches into a local allocation, so a callee cannot resize/free or mutate the
  caller's storage. Detached parameter buffers are released at function exit.
- Vararg packs and direct array-literal arguments use non-owning views.
- Owned array slots are freed before each function return, including early
  returns. Returning an owned array requires an explicit move.

## Deliberate limitations

- Nested block locals are dropped at block exit, loop-body locals are dropped
  on every iteration, and function-scope locals are dropped on every return.
  Full control-flow-aware destruction for all future ownership-bearing types
  remains a separate gate.
- Array parameter mutation is copy-on-write detachment, not an exclusive
  `&mut Array<T>` borrow.
- Element destruction is not yet generic. The current initial implementation
  is suitable for scalar/trivially stored elements and pointer-like `String`
  values whose string storage follows the existing runtime policy.
- Configurable initial/max capacity constructors, removal, `pop`, `Option`,
  nullable types, slices, shared ownership, and higher-order methods remain
  unimplemented. Generic element destruction is also pending; `clear()` currently
  only resets length and retains storage, so non-trivial element drop hooks are
  not yet supported.

## Verification

- TypeScript strict check: `tsc -p tsconfig.json --noEmit`.
- Full test suite: 72 tests pass, including generated-C integration for
  `reserve`, `shrinkToFit`, `clear`, capacity reads, and borrowed-parameter
  detachment.
- Generated C compiled with GCC using `-std=c11 -Wall -Wextra -Wpedantic`.
- Growth/mutation/move and capacity-management integration programs passed
  AddressSanitizer and UndefinedBehaviorSanitizer with leak detection enabled.
