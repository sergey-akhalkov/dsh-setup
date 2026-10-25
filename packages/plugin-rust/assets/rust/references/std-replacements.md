# Standard-library replacements

Check a replacement against the installed toolchain before using it. This mapping says what an API
replaces in hand-written code; it does not say which release added the API, because that claim
decays. The snapshot was checked on 2026-10-26 against material dated 2026-09-23. Use a stable API
only when the project's MSRV covers it, confirm with `rustc --version` and the official standard
library documentation, and compile the item in the real crate before relying on it.

## Control flow and code shape

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| nested `if let` and `if` binding checks                | let chains in `if` and `while` (edition 2024)                          |
| nested `match` or `if let` inside a match arm          | `if let` guards on match arms                                          |
| `matches!` plus `assert!` in tests                     | `assert_matches!`, `debug_assert_matches!`                             |
| `cfg_if!`-style selector chains                        | `cfg_select!`                                                          |
| closure-based one-off `Display` implementation         | `fmt::from_fn`                                                         |
| dropping a write guard, then taking a read lock        | `RwLockWriteGuard::downgrade`                                          |
| get/modify/set on a `Cell`                             | `Cell::update`                                                         |
| `#[allow]` with a reason and no expiry                 | `#[expect]`                                                            |
| one-time initialization of a value                     | `OnceLock`                                                             |
| eager global singleton through a closure               | `From<T> for LazyLock` (initialized now)                               |
| `map_or(false, ...)` on an `Option`                    | `Option::is_some_and`                                                  |

## Collections and slices

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| manual slice splitting with bounds math                | `as_chunks`/`as_rchunks`, `array_windows`                              |
| length-checked slice-to-array conversion               | `as_array`, `as_mut_array`                                             |
| drain-and-filter loop                                  | `extract_if` on `HashMap`, `HashSet`, `BTreeMap`, `BTreeSet`, `Vec`    |
| push-then-index                                        | `Vec::push_mut`, `Vec::insert_mut`                                     |
| `BTreeMap` insert-or-entry dance                       | `Entry::insert_entry`                                                  |
| pair of `pop_front`/`pop_back` checks                  | `VecDeque::pop_front_if`, `pop_back_if`                                |
| raw-parts extraction from `Vec` or `String`            | `into_raw_parts`                                                       |
| repeated `[value; N]` workarounds                      | `core::array::repeat`                                                  |
| index-based array initialization                       | `array::from_fn`                                                       |
| manual length-checked slicing                          | `slice::first_chunk`                                                   |

## Numbers, atomics and layout

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| widening casts for unsigned-minus-signed               | `uN::{checked,overflowing,saturating,wrapping}_sub_signed`             |
| panic-or-wrap arithmetic                               | `strict_add` through `strict_pow`                                      |
| shift tricks for bit positions                         | `highest_one`, `lowest_one`, `isolate_*`, `bit_width` (and `NonZero`)  |
| manual multi-precision arithmetic                      | `carrying_add`, `borrowing_sub`, `carrying_mul`, `carrying_mul_add`    |
| `fetch_update` with `Ordering` boilerplate             | `Atomic::update`, `Atomic::try_update`                                 |
| atomics over `&mut` data through unsafe code           | `Atomic::from_mut`, `from_mut_slice`, `get_mut_slice`                  |
| integer-to-bool cast                                   | `bool::try_from({integer})`                                            |
| manual ceiling division                                | `div_ceil`, `NonZero::div_ceil`                                        |
| allocation to format an integer                        | `format_into` with `fmt::NumBuffer`                                    |
| `Box`/`Rc`/`Arc` zeroed allocation via `MaybeUninit`   | `new_zeroed`, `new_zeroed_slice`                                       |
| manual `MaybeUninit` slice handling                    | `assume_init_ref`/`assume_init_mut`/`assume_init_drop`, `write_copy_of_slice`, `write_clone_of_slice` |
| `Layout` repetition math                               | `Layout::repeat`, `Layout::repeat_packed`                              |

## Text, paths and time

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| index math for parser spans                            | `str::substr_range`, `<[T]>::subslice_range`                           |
| byte-index boundary math on `str`                      | `ceil_char_boundary`, `floor_char_boundary`                            |
| matching prefix/suffix pair removal                    | `strip_circumfix`                                                      |
| UTF-16 decoding plus endian swap                       | `String::from_utf16le`/`from_utf16be` (and `_lossy` forms)             |
| hand-rolled radix parsing for non-zero integers        | `NonZero::from_str_radix`                                              |
| `Duration::from_secs(60 * n)` arithmetic               | `Duration::from_mins`, `from_hours`, `from_nanos_u128`                 |
| building paths as strings and editing extensions       | `Path::file_prefix`, `PathBuf::add_extension`, `with_added_extension`, `Path`/`PathBuf` equality with `str`/`String` |
| leaked owned OS string or path                         | `OsString::leak`, `PathBuf::leak`                                      |
| ad-hoc lock files                                      | `File::lock`, `File::lock_shared`, `try_lock*`, `unlock`               |

## Laziness and lifetimes

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| inspect a lazily initialized value without forcing it  | `LazyLock::get`, `get_mut`, `force_mut` (and `LazyCell`)               |
| hand-built ranges over non-zero integers               | ranges of `NonZero` integers                                          |
| `peek` plus map that must not consume                  | `Peekable::next_if_map`, `next_if_map_mut`                             |
| workaround to cast `char` into `usize`                 | `TryFrom<char> for usize`                                              |

## Frequently missed staples

| Hand-written pattern                                   | Prefer                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| nested `if` chain or `match` for an early return       | let-else                                                               |
| `format!` plus `push_str`                              | inline format args `{x}`                                               |
| type forced into `std` to implement `Error`            | `core::error::Error`                                                   |
| workaround to convert `dyn Trait` to `dyn Supertrait`  | trait upcasting                                                        |
| associated-type boilerplate for one implementation     | `impl Trait` in return position in traits                              |
