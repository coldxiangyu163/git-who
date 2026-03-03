# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-03

### Changed
- **Repositioned from "AI code tracking tool" to "AI code review tool"**
  - Reason: ghost project (intent-based commits) emerged as competitor with overlapping functionality
  - New focus: reviewer/auditor perspective vs developer perspective
  - Emphasis on review status, risk assessment, and audit trail

### Added
- **ghost integration**: Automatically detect and parse ghost-meta in commit messages
  - Read ghost-prompt, ghost-agent, ghost-model, ghost-session from commits
  - Auto-mark entire ghost commits as AI-generated
  - Display ghost metadata in review reports
- **Enhanced review status tracking**:
  - Review status column (✅ Reviewed / ❌ Not Reviewed / ⚠️ Needs Review)
  - Reviewer attribution (who reviewed which code)
  - Review timestamp tracking
- **Risk assessment system**:
  - Automatic risk scoring (0-10) based on AI code complexity and review status
  - High-risk code highlighting in CLI output
  - `--risk-threshold` flag for CI mode
  - Risk scores per file and project-wide
- **Review suggestions**:
  - Context-aware suggestions for unreviewed AI code
  - Complexity analysis (database queries, security-sensitive code)
  - Priority ranking for review queue
- **Audit trail**:
  - Track who reviewed which AI code and when
  - Export audit logs in JSON format
  - Compliance reporting for security audits

### Enhanced
- CLI output now emphasizes review status over attribution
- Statistics report includes risk assessment and review metrics
- Comparison table updated to highlight differentiation from ghost
- README repositioned to emphasize code review use cases
- Added "Key Differentiators" section to clarify positioning vs ghost

### Documentation
- Updated README with ghost integration examples
- Added complementary tools section (ghost + git-who workflow)
- Expanded use cases to include enterprise governance and audit scenarios
- Updated comparison table with ghost, memento, git-blame
- Added FAQ section on ghost integration

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
