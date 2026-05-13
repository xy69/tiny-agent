# Changelog

## 0.1.3 (2026-05-13)

### Docs

- Added package README with extension API docs, usage examples, and built-in extension reference.
- Added repository README with architecture overview, development commands, and examples guide.

## 0.1.2 (2026-05-13)

### Features

- **Runtime-agnostic build** — compiled ESM output (`.mjs`) works with Node.js, Deno, tsx, ts-node, and Bun without requiring Bun-specific APIs at runtime.
- **tsdown-powered build** — produces ESM bundles + declaration files (~36KB total) via rolldown.
- **Test suite** — 11 tests covering Agent class behavior, using TypeScript project references for type isolation.

### Refactoring

- **Monorepo restructure** — consolidated all sub-packages (`core`, `providers`, `extensions`, `session`) into a single `tiny-agent/` workspace package with subpath exports.
- **Replaced Bun-specific APIs** — `Bun.spawn` → Node.js `child_process.spawn`, `Glob` from `bun` → manual glob walker.
- **Examples moved** to top-level `examples/` directory.
- **Provider SDKs** are now optional peer dependencies — consumers only install what they use.

### Chores

- Added `prettier-plugin-organize-imports` for consistent import ordering.
- Formatted all source files.

## 0.1.1 (2026-05-12)

Initial release with Bun-only runtime.
