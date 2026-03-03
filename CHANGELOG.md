# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-03

### Added
- Initial release of git-who
- AI code detection for Claude Code, Cursor, and Git Trailers
- Line-by-line provenance tracking with model attribution
- Review status tracking (reviewed/unreviewed)
- Statistics report (`--stats`) showing AI code distribution
- CI mode (`--ci`) with configurable threshold for unreviewed code
- JSON output format (`--json`) for programmatic access
- Post-commit hook installation (`--init`)
- Configuration file support (`.gitwhorc`)
- Comprehensive test suite (104 tests)
- Support for multiple AI adapters simultaneously
- Git-notes based storage (non-invasive to commit history)

### Documentation
- Complete README with usage examples
- CLI reference documentation
- CI integration examples (GitHub Actions, GitLab CI)
- FAQ section
- Comparison table with alternative tools

[0.1.0]: https://github.com/coldxiangyu163/git-who/releases/tag/v0.1.0
