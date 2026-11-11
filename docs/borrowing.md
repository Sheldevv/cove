# Borrowing (Milestone 10)

Cove now recognizes shared borrow expressions (`&value`) and exclusive borrow
expressions (`&mut value`). The first borrow-checking pass checks call argument
lists: multiple shared borrows are accepted; a shared/exclusive or exclusive/
exclusive conflict is rejected; moving a value in the same call in which it is
borrowed is rejected.

Borrow expressions are currently compile-time-only and erased during IR
lowering. This milestone does **not** yet implement reference-typed function
parameters, dereferencing, mutation through `&mut`, non-lexical lifetimes, or
references escaping a function. In particular, `&mut` is syntax and conflict
checking groundwork, not yet a complete mutable-reference implementation.

## Examples

```cove
fun inspect(value: String) { print(value); }
fun main() {
    let message: String = "hello";
    inspect(&message);
    inspect(&message);
    print(message);
}
```

`examples/unsafe_borrow_conflict.cove` intentionally contains a conflicting
shared and exclusive borrow and should fail with `COV7001`.
