# git-who

[![CI](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml/badge.svg)](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/git-who.svg)](https://www.npmjs.com/package/git-who)
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
- name: AI Code Review Gate
  run: npx git-who --ci --threshold 20
```

## Why git-who?

| Feature | git-blame | memento | CodeGPT | **git-who** |
|---------|-----------|---------|---------|-------------|
| Line-level attribution | ✅ (human only) | ❌ | ❌ | ✅ |
| AI model tracking | ❌ | ✅ (session) | ❌ | ✅ |
| Review status | ❌ | ❌ | ❌ | ✅ |
| Statistics | ❌ | ❌ | ❌ | ✅ |
| CI gate | ❌ | ❌ | ❌ | ✅ |
| Clean git history | — | ❌ (modifies commits) | ❌ | ✅ (git-notes) |

## License

MIT © [coldxiangyu](https://github.com/coldxiangyu163)
