'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Modules under test
const {
  showProvenance,
  parseGitBlame,
  buildProvenanceMap,
  groupConsecutiveLines,
  padRight,
  truncate,
} = require('../src/reporter.js');

const {
  gatherStats,
  showStats,
  ciCheck,
  loadConfig,
  countProjectLines,
  drawBar,
} = require('../src/stats.js');

const { addTrace, getTrace } = require('../src/tracer.js');

// ── Helpers ──

function createTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitwho-rs-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });

  // Create a source file and commit
  fs.writeFileSync(path.join(dir, 'hello.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });

  const commitHash = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
  return { dir, commitHash };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════
// Reporter Tests
// ═══════════════════════════════════════════════════

describe('reporter — truncate', () => {
  it('returns original string if shorter than maxLen', () => {
    assert.strictEqual(truncate('hello', 10), 'hello');
  });

  it('truncates with ellipsis when longer', () => {
    const result = truncate('hello world', 6);
    assert.strictEqual(result.length, 6);
    assert.ok(result.endsWith('…'));
  });

  it('handles empty string', () => {
    assert.strictEqual(truncate('', 10), '');
  });

  it('handles null/undefined', () => {
    assert.strictEqual(truncate(null, 10), '');
    assert.strictEqual(truncate(undefined, 10), '');
  });
});

describe('reporter — padRight', () => {
  it('pads short string', () => {
    assert.strictEqual(padRight('hi', 5), 'hi   ');
  });

  it('does not pad when string is already long enough', () => {
    assert.strictEqual(padRight('hello', 3), 'hello');
  });

  it('handles exact length', () => {
    assert.strictEqual(padRight('abc', 3), 'abc');
  });
});

describe('reporter — groupConsecutiveLines', () => {
  it('groups consecutive human lines', () => {
    const lines = [
      { lineNum: 1, content: 'a', prov: null, blame: null },
      { lineNum: 2, content: 'b', prov: null, blame: null },
      { lineNum: 3, content: 'c', prov: null, blame: null },
    ];
    const groups = groupConsecutiveLines(lines);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 3);
  });

  it('splits human and AI lines into separate groups', () => {
    const aiProv = { model: 'claude-sonnet', reviewed: false };
    const lines = [
      { lineNum: 1, content: 'a', prov: null, blame: null },
      { lineNum: 2, content: 'b', prov: aiProv, blame: null },
      { lineNum: 3, content: 'c', prov: aiProv, blame: null },
      { lineNum: 4, content: 'd', prov: null, blame: null },
    ];
    const groups = groupConsecutiveLines(lines);
    assert.strictEqual(groups.length, 3);
    assert.strictEqual(groups[0].length, 1); // human
    assert.strictEqual(groups[1].length, 2); // AI
    assert.strictEqual(groups[2].length, 1); // human
  });

  it('splits different AI models into separate groups', () => {
    const lines = [
      { lineNum: 1, content: 'a', prov: { model: 'claude' }, blame: null },
      { lineNum: 2, content: 'b', prov: { model: 'gpt-4o' }, blame: null },
    ];
    const groups = groupConsecutiveLines(lines);
    assert.strictEqual(groups.length, 2);
  });

  it('handles non-consecutive line numbers', () => {
    const lines = [
      { lineNum: 1, content: 'a', prov: null, blame: null },
      { lineNum: 5, content: 'b', prov: null, blame: null },
    ];
    const groups = groupConsecutiveLines(lines);
    assert.strictEqual(groups.length, 2);
  });

  it('handles empty input', () => {
    const groups = groupConsecutiveLines([]);
    assert.strictEqual(groups.length, 0);
  });
});

describe('reporter — parseGitBlame', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('parses blame for a committed file', () => {
    const result = parseGitBlame('hello.js', { cwd: repo.dir });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].line, 1);
    assert.strictEqual(result[0].author, 'Test User');
    assert.ok(result[0].commit.length === 8);
    assert.strictEqual(result[0].content, 'const a = 1;');
  });

  it('returns empty array for non-existent file', () => {
    const result = parseGitBlame('nonexistent.js', { cwd: repo.dir });
    assert.deepStrictEqual(result, []);
  });
});

describe('reporter — buildProvenanceMap', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns empty map when no traces exist', () => {
    const map = buildProvenanceMap('hello.js', { cwd: repo.dir });
    assert.strictEqual(map.size, 0);
  });

  it('returns map with traced lines', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'abc123', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'abc123', reviewed: true },
    ], { cwd: repo.dir });

    const map = buildProvenanceMap('hello.js', { cwd: repo.dir });
    assert.strictEqual(map.size, 2);
    assert.strictEqual(map.get(1).model, 'claude-sonnet');
    assert.strictEqual(map.get(2).reviewed, true);
  });
});

describe('reporter — showProvenance', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns line data for a file with no AI traces', async () => {
    const result = await showProvenance(repo.dir, 'hello.js', { json: true });
    assert.ok(Array.isArray(result));
    // File has 3 lines + trailing newline = 4 entries from split('\n')
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0].line, 1);
    assert.strictEqual(result[0].author, 'human');
    assert.strictEqual(result[0].model, null);
  });

  it('returns AI attribution in JSON mode', async () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'p1', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'p1', reviewed: true },
    ], { cwd: repo.dir });

    const result = await showProvenance(repo.dir, 'hello.js', { json: true });
    assert.strictEqual(result[0].author, 'ai');
    assert.strictEqual(result[0].model, 'claude-sonnet');
    assert.strictEqual(result[0].reviewed, false);
    assert.strictEqual(result[1].author, 'ai');
    assert.strictEqual(result[1].reviewed, true);
    assert.strictEqual(result[2].author, 'human');
  });

  it('throws for non-existent file', async () => {
    await assert.rejects(
      () => showProvenance(repo.dir, 'nope.js'),
      { message: /File not found/ }
    );
  });

  it('filters by model', async () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'p1', reviewed: false },
      { line: 2, model: 'gpt-4o', promptHash: 'p2', reviewed: false },
    ], { cwd: repo.dir });

    const result = await showProvenance(repo.dir, 'hello.js', {
      json: true,
      model: 'claude-sonnet',
    });

    // Line 2 (gpt-4o) should be filtered out
    const aiLines = result.filter(l => l.author === 'ai');
    assert.strictEqual(aiLines.length, 1);
    assert.strictEqual(aiLines[0].model, 'claude-sonnet');
  });

  it('colored output mode returns allLines array', async () => {
    // Non-json mode should still return allLines
    const result = await showProvenance(repo.dir, 'hello.js', { json: false });
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  });
});

// ═══════════════════════════════════════════════════
// Stats Tests
// ═══════════════════════════════════════════════════

describe('stats — drawBar', () => {
  it('draws full bar when value equals max', () => {
    const bar = drawBar(10, 10, 10);
    assert.strictEqual(bar, '██████████');
  });

  it('draws minimum 1 filled block when value is 0 but maxValue > 0', () => {
    const bar = drawBar(0, 10, 10);
    // drawBar uses Math.max(1, ...) so minimum 1 filled block
    assert.strictEqual(bar, '█░░░░░░░░░');
  });

  it('draws half bar', () => {
    const bar = drawBar(5, 10, 10);
    assert.strictEqual(bar.length, 10);
    assert.ok(bar.includes('█'));
    assert.ok(bar.includes('░'));
  });

  it('handles maxValue of 0', () => {
    const bar = drawBar(0, 0, 10);
    assert.strictEqual(bar, '░░░░░░░░░░');
  });
});

describe('stats — loadConfig', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns defaults when no .gitwhorc exists', () => {
    const config = loadConfig(repo.dir);
    assert.strictEqual(config.version, 1);
    assert.strictEqual(config.ci.threshold, 50);
    assert.strictEqual(config.ci.failOnUnreviewed, true);
    assert.ok(Array.isArray(config.adapters));
  });

  it('loads custom config from .gitwhorc', () => {
    fs.writeFileSync(
      path.join(repo.dir, '.gitwhorc'),
      JSON.stringify({ ci: { threshold: 25 } })
    );
    const config = loadConfig(repo.dir);
    assert.strictEqual(config.ci.threshold, 25);
    // Defaults still present
    assert.strictEqual(config.ci.failOnUnreviewed, true);
  });

  it('handles invalid JSON in .gitwhorc', () => {
    fs.writeFileSync(path.join(repo.dir, '.gitwhorc'), 'not json{{{');
    const config = loadConfig(repo.dir);
    assert.strictEqual(config.ci.threshold, 50); // falls back to defaults
  });
});

describe('stats — gatherStats', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns zero stats when no traces exist', () => {
    const stats = gatherStats(repo.dir);
    assert.strictEqual(stats.totalCommits, 0);
    assert.strictEqual(stats.totalFiles, 0);
    assert.strictEqual(stats.totalAILines, 0);
    assert.strictEqual(stats.reviewedLines, 0);
    assert.strictEqual(stats.unreviewedLines, 0);
  });

  it('counts AI lines and models from traces', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a1', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'a1', reviewed: true },
      { line: 3, model: 'gpt-4o', promptHash: 'b1', reviewed: false },
    ], { cwd: repo.dir });

    const stats = gatherStats(repo.dir);
    assert.strictEqual(stats.totalCommits, 1);
    assert.strictEqual(stats.totalFiles, 1);
    assert.strictEqual(stats.totalAILines, 3);
    assert.strictEqual(stats.reviewedLines, 1);
    assert.strictEqual(stats.unreviewedLines, 2);
    assert.strictEqual(stats.models['claude-sonnet'], 2);
    assert.strictEqual(stats.models['gpt-4o'], 1);
  });

  it('aggregates per-file stats', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
    ], { cwd: repo.dir });

    // Add another file in a second commit
    fs.writeFileSync(path.join(repo.dir, 'world.js'), 'export default {};\n');
    execSync('git add -A', { cwd: repo.dir, stdio: 'ignore' });
    execSync('git commit -m "add world"', { cwd: repo.dir, stdio: 'ignore' });
    const commit2 = execSync('git rev-parse HEAD', { cwd: repo.dir, encoding: 'utf-8' }).trim();

    addTrace(commit2, 'world.js', [
      { line: 1, model: 'gpt-4o', promptHash: 'b', reviewed: false },
    ], { cwd: repo.dir });

    const stats = gatherStats(repo.dir);
    assert.strictEqual(stats.totalFiles, 2);
    assert.strictEqual(stats.totalCommits, 2);
    assert.ok(stats.files['hello.js']);
    assert.ok(stats.files['world.js']);
    assert.strictEqual(stats.files['hello.js'].aiLines, 1);
    assert.strictEqual(stats.files['world.js'].aiLines, 1);
  });

  it('tracks directory-level statistics', () => {
    // Create a nested file
    fs.mkdirSync(path.join(repo.dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, 'src', 'app.js'), 'console.log("app");\n');
    execSync('git add -A', { cwd: repo.dir, stdio: 'ignore' });
    execSync('git commit -m "add src/app.js"', { cwd: repo.dir, stdio: 'ignore' });
    const commit = execSync('git rev-parse HEAD', { cwd: repo.dir, encoding: 'utf-8' }).trim();

    addTrace(commit, 'src/app.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'x', reviewed: false },
    ], { cwd: repo.dir });

    const stats = gatherStats(repo.dir);
    assert.ok(stats.directories['src']);
    assert.strictEqual(stats.directories['src'].aiLines, 1);
    assert.strictEqual(stats.directories['src'].fileCount, 1);
  });
});

describe('stats — showStats', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns stats object in JSON mode', async () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
    ], { cwd: repo.dir });

    const stats = await showStats(repo.dir, { json: true });
    assert.ok(stats);
    assert.strictEqual(stats.totalCommits, 1);
    assert.strictEqual(stats.totalAILines, 1);
  });

  it('handles empty project gracefully', async () => {
    const stats = await showStats(repo.dir, { json: true });
    assert.strictEqual(stats.totalCommits, 0);
  });
});

describe('stats — ciCheck', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('passes when no AI code exists', async () => {
    const result = await ciCheck(repo.dir, { exitProcess: false });
    assert.strictEqual(result.pass, true);
    assert.ok(result.message.includes('No AI-generated code'));
  });

  it('passes when unreviewed is below threshold', async () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
      { line: 2, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
      { line: 3, model: 'claude-sonnet', promptHash: 'a', reviewed: false },
    ], { cwd: repo.dir });

    // 33% unreviewed, threshold 50%
    const result = await ciCheck(repo.dir, { threshold: 50, exitProcess: false });
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.unreviewedPct, 33);
  });

  it('fails when unreviewed exceeds threshold', async () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'a', reviewed: false },
      { line: 3, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
    ], { cwd: repo.dir });

    // 67% unreviewed, threshold 50%
    const result = await ciCheck(repo.dir, { threshold: 50, exitProcess: false });
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.unreviewedPct, 67);
  });

  it('uses .gitwhorc threshold when no CLI override', async () => {
    fs.writeFileSync(
      path.join(repo.dir, '.gitwhorc'),
      JSON.stringify({ ci: { threshold: 10 } })
    );

    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
    ], { cwd: repo.dir });

    // 50% unreviewed, .gitwhorc threshold 10%
    const result = await ciCheck(repo.dir, { exitProcess: false });
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.threshold, 10);
  });

  it('CLI threshold overrides .gitwhorc', async () => {
    fs.writeFileSync(
      path.join(repo.dir, '.gitwhorc'),
      JSON.stringify({ ci: { threshold: 10 } })
    );

    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'a', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'a', reviewed: true },
    ], { cwd: repo.dir });

    // 50% unreviewed, CLI threshold 80%
    const result = await ciCheck(repo.dir, { threshold: 80, exitProcess: false });
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.threshold, 80);
  });
});

// ═══════════════════════════════════════════════════
// End-to-End: init → commit → who → stats
// ═══════════════════════════════════════════════════

describe('end-to-end: init → trace → who → stats → ci', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('full workflow produces correct results', async () => {
    // Step 1: Add AI traces to the commit
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet', promptHash: 'full-e2e', reviewed: false },
      { line: 2, model: 'claude-sonnet', promptHash: 'full-e2e', reviewed: true },
    ], { cwd: repo.dir });

    // Step 2: showProvenance (JSON)
    const provResult = await showProvenance(repo.dir, 'hello.js', { json: true });
    // 3 lines + trailing newline = 4 entries
    assert.strictEqual(provResult.length, 4);
    assert.strictEqual(provResult[0].author, 'ai');
    assert.strictEqual(provResult[0].model, 'claude-sonnet');
    assert.strictEqual(provResult[2].author, 'human');

    // Step 3: gatherStats
    const stats = gatherStats(repo.dir);
    assert.strictEqual(stats.totalAILines, 2);
    assert.strictEqual(stats.reviewedLines, 1);
    assert.strictEqual(stats.unreviewedLines, 1);
    assert.strictEqual(stats.models['claude-sonnet'], 2);

    // Step 4: ciCheck — 50% unreviewed, threshold 60% → pass
    const ciResult = await ciCheck(repo.dir, { threshold: 60, exitProcess: false });
    assert.strictEqual(ciResult.pass, true);

    // Step 5: ciCheck — threshold 10% → fail
    const ciResult2 = await ciCheck(repo.dir, { threshold: 10, exitProcess: false });
    assert.strictEqual(ciResult2.pass, false);
  });
});
