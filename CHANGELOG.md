# Changelog

## Unreleased

- Clarify installation from a repository tarball, add a JavaScript quick start with common procedure calls, and explain how to check generated results.
- Add contributor engineering principles and correct the contributor guide to use the repository root.

## 0.1.0

- Extract AutoBD from the API into an installable SQL Server generator.
- Provide the `autobd generate` CLI with consumer-owned config, runtime adapter, output and logs.
- Preserve generated procedure return values, result contracts, TVPs, JS/TS output and failure diagnostics.
- Continue generation after procedure mapping errors, skip invalid wrappers, and record a partial run with all causes.
- Support `--procedure schema.name` for incremental regeneration of one stored procedure and its required TVPs.
- Document installation, configuration, targeted regeneration, and report verification in the package README for people and AI agents.
- Keep hand-written files safe during full generation and produce JSDoc wrappers that pass TypeScript `checkJs` for required parameters and TVPs.
- Record E2E precision limits for high-precision DECIMAL and DATETIME2 values; exact high-precision SELECT values require an explicit string contract.

Versions follow semantic versioning. Breaking changes to the CLI, config, generated wrapper API or result-contract format require a major version after 1.0. Before 1.0, document such changes prominently in this file.
