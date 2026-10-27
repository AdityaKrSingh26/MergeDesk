# Add `clamp()` helper and unit test

Add a `clamp(n, min, max)` helper next to the existing `abs()` math utility.

- Return `min` when `n` is below `min`
- Return `max` when `n` is above `max`
- Return `n` otherwise
- Use the local `./math` import for absolute-value needs
- Add unit tests in `src/clamp.test.ts`

Do not add new packages.
