# git-who

[![CI](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml/badge.svg)](https://github.com/coldxiangyu163/git-who/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/git-who.svg)](https://www.npmjs.com/package/git-who)
[![npm downloads](https://img.shields.io/npm/dm/git-who.svg)](https://www.npmjs.com/package/git-who)
[![Node.js Version](https://img.shields.io/node/v/git-who.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **AI Code Review Tool** — `git blame` for AI. Line-level tracking, review status, and risk assessment for AI-generated code.

As AI coding tools (Claude Code, Cursor, Copilot) become mainstream, teams need to **review AI-generated code** before it reaches production. git-who provides line-level tracking, review status, and risk assessment for AI code.

## Key Differentiators

- **Line-level granularity**: Unlike commit-level tools (ghost), git-who tracks AI attribution per line
- **Reviewer perspective**: Built for code reviewers and auditors, not developers
- **Risk assessment**: Automatic risk scoring based on AI code complexity and review status
- **CI integration**: Block merges when unreviewed AI code exceeds thresholds
- **ghost-compatible**: Reads ghost-meta to auto-mark entire commits as AI-generated

## Use Cases

- **Code Review**: Identify which AI-generated lines need human review before merging
- **Compliance Audits**: Track AI code provenance for security and regulatory requirements
- **Quality Control**: Monitor AI code quality across models and projects
- **Team Collaboration**: Ensure AI-generated code is reviewed by senior developers
- **Open Source Maintenance**: Verify contributor code provenance and review status
- **Enterprise Governance**: Enforce AI code review policies across teams

## Demo

```
$ git who src/index.js

src/index.js
────────────────────────────────────────────────────────
  👤 Human: 15 lines  |  🤖 AI: 42 lines  |  ✅ Reviewed: 35/42
  ⚠️  Risk Score: 6.2/10 (7 lines need review)
────────────────────────────────────────────────────────

  👤 L1-15        Human
  🤖 L16-42       claude-sonnet-4-20250514  ✅ Reviewed  #a3f2c891
  👤 L43-50       Human
  🤖 L51-89       gpt-4o         ❌ Not Reviewed  #7b1e4d02  ⚠️ High Risk

  💡 Review Suggestions:
     • L51-89: Database query optimization (high complexity, security-sensitive)
     • L16-42: Already reviewed by alice@example.com on 2026-03-02
```

```
$ git who --stats

📊 git-who Code Review Report
──────────────────────────────────────────────────
  Tracked commits:    23
  Files with AI code: 8
  AI-generated lines: 342
  Reviewed:           289 (84%)
  Unreviewed:         53 (16%)  ⚠️
  
  ⚠️  Risk Assessment: MEDIUM (6.2/10)
     • 3 files with unreviewed AI code in critical paths
     • 2 files exceed 50% AI code without review
     • 1 file with high-complexity unreviewed AI code

  Review Status:
    ✅ Reviewed:        289 lines (84%)
    ❌ Not Reviewed:     53 lines (16%)
    ⚠️  Needs Review:    12 lines (high risk)

  Models:
    claude-sonnet-4-20250514       ████████████ 198 (58%)  ✅ 95% reviewed
    gpt-4o               ██████ 102 (30%)  ⚠️ 65% reviewed
    gemini-2.5-pro        ██ 42 (12%)   ✅ 100% reviewed

  Top files needing review:
    src/detector.js                67 AI lines  3 unreviewed  🔴 Risk: 7.8/10
    src/auth.js                    45 AI lines  12 unreviewed 🔴 Risk: 8.2/10
    src/reporter.js                52 AI lines  all reviewed  ✅ Risk: 2.1/10
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
| **ghost** | `ghost-meta` in commit message | ✅ Supported |
| Copilot | — | 🔜 Planned |

### ghost Integration

git-who automatically detects [ghost](https://github.com/adamveld12/ghost) commits and marks entire commits as AI-generated:

```bash
# ghost commit creates:
add JWT authentication

ghost-meta
ghost-prompt: add JWT authentication middleware
ghost-agent: claude
ghost-model: claude-sonnet-4-20250514
ghost-session: 7f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c

# git-who automatically detects and marks all lines in this commit as AI
$ git who src/auth.js
  🤖 L1-45  claude-sonnet-4-20250514  ❌ Not Reviewed  ghost:7f3a2b1c
  
  💡 This commit was created by ghost (intent-based commit)
     Original prompt: "add JWT authentication middleware"
     Review recommended before production deployment
```

**Complementary Tools**:
- **ghost**: Intent-based commits (developer perspective, commit-level tracking, proactive)
- **git-who**: Code review tool (reviewer perspective, line-level tracking, reactive)

Use both together:
1. Developers use ghost to commit AI-generated code with intent metadata
2. Reviewers use git-who to audit and review AI code before merging

## CLI Reference

```
git who <file>          Show AI provenance and review status for each line
git who --init          Install post-commit hook
git who --stats         Show project-level AI code review statistics
git who --ci            CI mode (exit 1 if unreviewed AI code > threshold)
git who --review <file> Mark AI code as reviewed (interactive)
git who --version       Show version
git who --help          Show help

Options:
  --json                Output in JSON format
  --model <name>        Filter by AI model
  --reviewed            Show only reviewed lines
  --unreviewed          Show only unreviewed lines
  --needs-review        Show only high-risk unreviewed lines
  --threshold <n>       CI mode: max % of unreviewed AI code (default: 20)
  --risk-threshold <n>  CI mode: max risk score (default: 7.0)
```

## Configuration

Create `.gitwhorc` in your repo root (auto-created by `git who --init`):

```json
{
  "version": 1,
  "adapters": ["claude", "cursor", "ghost"],
  "ci": {
    "threshold": 20,
    "riskThreshold": 7.0,
    "failOnUnreviewed": true,
    "failOnHighRisk": true
  },
  "review": {
    "requireReviewer": true,
    "autoMarkGhostAsReviewed": false
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

### The AI Code Review Problem

As AI coding assistants generate more production code, teams need systematic code review processes:

- **Review Workflow**: Which AI-generated lines need human review before production?
- **Risk Assessment**: What's the risk level of unreviewed AI code in critical paths?
- **Compliance**: Can we prove all AI code was reviewed for security audits?
- **Quality Control**: Which AI models produce code that passes review most often?
- **Audit Trail**: Who reviewed which AI-generated code and when?

Traditional code review tools don't distinguish AI-generated code from human code. git-who provides line-level tracking, review status, and risk assessment specifically for AI code.

### Comparison

| Feature | git-blame | ghost | memento | **git-who** |
|---------|-----------|-------|---------|-------------|
| Line-level tracking | ✅ (human only) | ❌ (commit-level) | ❌ | ✅ |
| AI model tracking | ❌ | ✅ | ✅ (session) | ✅ |
| Review status | ❌ | ❌ | ❌ | ✅ |
| Risk assessment | ❌ | ❌ | ❌ | ✅ |
| Review suggestions | ❌ | ❌ | ❌ | ✅ |
| CI gate | ❌ | ❌ | ❌ | ✅ |
| Audit trail | ❌ | ❌ | ❌ | ✅ |
| ghost integration | N/A | N/A | N/A | ✅ |
| Target user | Developer | Developer | Developer | **Reviewer/Auditor** |
| Use case | Attribution | Intent tracking | Session logs | **Code review & audit** |
| Workflow | Passive | Proactive | Passive | **Reactive** |

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
