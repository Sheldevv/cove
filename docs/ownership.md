# Cove ownership model — initial slice

## Current rule

`String` is the first non-Copy type. `move(name)` transfers the source binding. The source becomes unavailable until it is assigned a new value. A move is compile-time checked and lowers to the existing IR operand, so it has no runtime wrapper or copy cost.

## Control flow

Ownership state is merged conservatively at `if` joins and after loops. If any path may have moved a String, a later read is rejected. This deliberately favors safety over accepting every path-sensitive program.

## Not implemented yet

- Shared and exclusive borrowing (`&T`, `&mut T`).
- Borrow lifetime and escape analysis.
- Automatic drop insertion and reverse declaration-order cleanup.
- User-defined resource types and destructors.
- Heap allocation ownership and allocator APIs.
- Partial moves and field-level ownership.

These features require user-defined types, richer IR resource operations, and cleanup edges for returns and control-flow exits. They must not be approximated by blindly freeing C pointers.
