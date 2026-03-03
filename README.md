# git-who

[![CI](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml/badge.svg)](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/git-who.svg)](https://www.npmjs.com/package/git-who)
[![npm downloads](https://img.shields.io/npm/dm/git-who.svg)](https://www.npmjs.com/package/git-who)
[![Node.js Version](https://img.shields.io/node/v/git-who.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> `git blame` for AI — Track which lines were AI-generated, by which model, and whether they've been reviewed.

As AI coding tools (Claude Code, Cursor, Copilot) become mainstream, teams face a critical question: **which code was written by AI, and has it been reviewed?**

git-who answers this by tracking AI code provenance at the line level.

## Demo

```
$ git who src/index.js

src/index.js
────────────────────────────────────────────────────────
  👤 Human: 15 lines  |  🤖 AI: 42 lines  |  ✅ Reviewed: 35/42
────────────────────────────────────────────────────────

  👤 L1-15        Human
  🤖 L16-42       claude-sonnet-4-20250514  ✅  #a3f2c891
  👤 L43-50       Human
  🤖 L51-89       gpt-4o         ❌  #7b1e4d02
```

```
$ git who --stats

📊 git-who Statistics
──────────────────────────────────────────────────
  Tracked commits:    23
  Files with AI code: 8
  AI-generated lines: 342
  Reviewed:           289 (84%)
  Unreviewed:         53

  Models:
    claude-sonnet-4-20250514       ████████████ 198 (58%)
    gpt-4o               ██████ 102 (30%)
    gemini-2.5-pro        ██ 42 (12%)

  Top files:
    src/index.js                   89 AI lines  all reviewed
    src/detector.js                67 AI lines  3 unreviewed
    src/reporter.js                52 AI lines  all reviewed
```

## Install

```bash
npm install -g git-who
```

## Quick Start

```bash
# Initialize in your repo (installs post-commit hook)
git who --init

# View AI provenance for a file
git who src/index.js

# Project-wide statistics
git who --stats

# CI gate: fail if >20% AI code is unreviewed
git who --ci --threshold 20
```

## How It Works

1. **Detection** — On each commit, git-who analyzes the diff against AI tool session logs (Claude Code, Cursor) to identify AI-generated lines
2. **Storage** — Provenance metadata is stored in `git-notes` (not commit messages), keeping your history clean
3. **Query** — `git who <file>` shows line-by-line attribution with model, prompt hash, and review status

### Supported AI Tools

| Tool | Session Log Location | Status |
|------|---------------------|--------|
| Claude Code | `~/.claude/projects/*/session_*` | ✅ Supported |
| Cursor | `.cursor/sessions/` | ✅ Supported |
| Git Trailers | `AI-Model:` in commit message | ✅ Supported |
| Copilot | — | 🔜 Planned |

## CLI Reference

```
git who <file>          Show AI provenance for each line
git who --init          Install post-commit hook
git who --stats         Show project-level AI code statistics
git who --ci            CI mode (exit 1 if unreviewed AI code > threshold)
git who --version       Show version
git who --help          Show help

Options:
  --json                Output in JSON format
  --model <name>        Filter by AI model
  --reviewed            Show only reviewed lines
  --unreviewed          Show only unreviewed lines
  --threshold <n>       CI mode: max % of unreviewed AI code (default: 20)
```

## Configuration

Create `.gitwhorc` in your repo root (auto-created by `git who --init`):

```json
{
  "version": 1,
  "adapters": ["claude", "cursor"],
  "ci": {
    "threshold": 20,
    "failOnUnreviewed": true
  },
  "ignore": ["node_modules/**", "dist/**", "*.min.js"]
}
```

## CI Integration

### GitHub Actions

```yaml
name: AI Code Review Gate

on: [push, pull_request]

jobs:
  ai-review-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need full history for git-notes
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Check AI code review status
        run: |
          npx git-who --ci --threshold 20
          # Fails if >20% of AI code is unreviewed
```

### GitLab CI

```yaml
ai-review-gate:
  stage: test
  script:
    - npm install -g git-who
    - git who --ci --threshold 20
  only:
    - merge_requests
```

## Why git-who?

### The AI Code Provenance Problem

As AI coding assistants generate more production code, teams face critical questions:

- **Audit**: Which lines were AI-generated vs human-written?
- **Review**: Has AI code been reviewed by a human?
- **Compliance**: Can we prove code provenance for security audits?
- **Quality**: Which AI models produce the most maintainable code?

Traditional `git blame` only shows commits, not whether code was AI-generated. git-who solves this.

### Comparison

| Feature | git-blame | memento | CodeGPT | **git-who** |
|---------|-----------|---------|---------|-------------|
| Line-level attribution | ✅ (human only) | ❌ | ❌ | ✅ |
| AI model tracking | ❌ | ✅ (session) | ❌ | ✅ |
| Review status | ❌ | ❌ | ❌ | ✅ |
| Statistics | ❌ | ❌ | ❌ | ✅ |
| CI gate | ❌ | ❌ | ❌ | ✅ |
| Clean git history | — | ❌ (modifies commits) | ❌ | ✅ (git-notes) |

## FAQ

### How does git-who detect AI-generated code?

git-who uses multiple detection strategies:

1. **Session logs**: Parses Claude Code and Cursor session files to match diffs
2. **Git trailers**: Reads `AI-Model:` trailers in commit messages
3. **Heuristics**: Analyzes commit patterns (large diffs, specific file types)

### Does it modify my git history?

No. git-who stores metadata in `git-notes` (a parallel data structure), keeping your commit history clean.

### What if I use multiple AI tools?

git-who supports multiple adapters simultaneously. Configure in `.gitwhorc`:

```json
{
  "adapters": ["claude", "cursor", "copilot"]
}
```

### Can I mark AI code as reviewed?

Yes, use git trailers:

```bash
git commit -m "Fix bug in parser

AI-Model: claude-sonnet-4
Reviewed-By: alice@example.com"
```

### Does it work with monorepos?

Yes. Run `git who --init` at the repo root. Each subproject can have its own `.gitwhorc`.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © [coldxiangyu](https://github.com/coldxiangyu163)
