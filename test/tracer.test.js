'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  NOTES_REF,
  addTrace,
  getTrace,
  getAllTraces,
  markReviewed,
  updateTrace,
  getTracedCommits,
  escapeShellArg,
} = require('../src/tracer.js');

/**
 * Helper: create a temp git repo with an initial commit
 * Returns { dir, commitHash }
 */
function createTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitwho-tracer-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });

  // Create a file and commit
  fs.writeFileSync(path.join(dir, 'hello.js'), 'console.log("hello");\n');
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

describe('NOTES_REF', () => {
  it('uses refs/notes/git-who', () => {
    assert.strictEqual(NOTES_REF, 'refs/notes/git-who');
  });
});

describe('escapeShellArg', () => {
  it('wraps string in single quotes', () => {
    const result = escapeShellArg('hello');
    assert.strictEqual(result, "'hello'");
  });

  it('escapes single quotes inside string', () => {
    const result = escapeShellArg("it's a test");
    assert.ok(result.includes("'\\''"));
  });

  it('handles JSON strings', () => {
    const json = '{"key":"value"}';
    const result = escapeShellArg(json);
    assert.ok(result.startsWith("'"));
    assert.ok(result.endsWith("'"));
  });
});

describe('addTrace + getTrace (integration)', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('adds and retrieves a trace with array format', () => {
    const traces = [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'abc12345', reviewed: false },
    ];

    addTrace(repo.commitHash, 'hello.js', traces, { cwd: repo.dir });
    const result = getTrace(repo.commitHash, { cwd: repo.dir });

    assert.ok(result);
    assert.ok(result['hello.js']);
    assert.strictEqual(result['hello.js'].length, 1);
    assert.strictEqual(result['hello.js'][0].line, 1);
    assert.strictEqual(result['hello.js'][0].model, 'claude-sonnet-4-20250514');
    assert.strictEqual(result['hello.js'][0].promptHash, 'abc12345');
  });

  it('adds trace with lineRange format', () => {
    addTrace(repo.commitHash, 'hello.js', { start: 1, end: 3 }, {
      model: 'gpt-4o',
      prompt_hash: 'range123',
      reviewed: false,
    }, { cwd: repo.dir });

    const result = getTrace(repo.commitHash, { cwd: repo.dir });

    assert.ok(result);
    assert.ok(result['hello.js']);
    assert.strictEqual(result['hello.js'].length, 3);
    assert.strictEqual(result['hello.js'][0].line, 1);
    assert.strictEqual(result['hello.js'][1].line, 2);
    assert.strictEqual(result['hello.js'][2].line, 3);
    assert.strictEqual(result['hello.js'][0].model, 'gpt-4o');
  });

  it('avoids duplicate line entries', () => {
    const traces = [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'abc12345' },
    ];

    addTrace(repo.commitHash, 'hello.js', traces, { cwd: repo.dir });
    addTrace(repo.commitHash, 'hello.js', traces, { cwd: repo.dir });

    const result = getTrace(repo.commitHash, { cwd: repo.dir });
    assert.strictEqual(result['hello.js'].length, 1);
  });

  it('supports multiple files in one commit', () => {
    addTrace(repo.commitHash, 'file1.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'aaa' },
    ], { cwd: repo.dir });

    addTrace(repo.commitHash, 'file2.js', [
      { line: 5, model: 'gpt-4o', promptHash: 'bbb' },
    ], { cwd: repo.dir });

    const result = getTrace(repo.commitHash, { cwd: repo.dir });
    assert.ok(result['file1.js']);
    assert.ok(result['file2.js']);
    assert.strictEqual(result['file1.js'][0].model, 'claude-sonnet-4-20250514');
    assert.strictEqual(result['file2.js'][0].model, 'gpt-4o');
  });

  it('returns null for commit with no trace', () => {
    const result = getTrace(repo.commitHash, { cwd: repo.dir });
    assert.strictEqual(result, null);
  });
});

describe('getAllTraces', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns all traces for a commit', () => {
    addTrace(repo.commitHash, 'a.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'x' },
    ], { cwd: repo.dir });
    addTrace(repo.commitHash, 'b.js', [
      { line: 2, model: 'gpt-4o', promptHash: 'y' },
    ], { cwd: repo.dir });

    const all = getAllTraces(repo.commitHash, null, { cwd: repo.dir });
    assert.ok(all['a.js']);
    assert.ok(all['b.js']);
  });

  it('filters by file when specified', () => {
    addTrace(repo.commitHash, 'a.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'x' },
    ], { cwd: repo.dir });
    addTrace(repo.commitHash, 'b.js', [
      { line: 2, model: 'gpt-4o', promptHash: 'y' },
    ], { cwd: repo.dir });

    const filtered = getAllTraces(repo.commitHash, 'a.js', { cwd: repo.dir });
    assert.ok(filtered['a.js']);
    assert.ok(!filtered['b.js']);
  });

  it('returns null for non-existent file filter', () => {
    addTrace(repo.commitHash, 'a.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'x' },
    ], { cwd: repo.dir });

    const result = getAllTraces(repo.commitHash, 'nonexistent.js', { cwd: repo.dir });
    assert.strictEqual(result, null);
  });
});

describe('markReviewed', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('marks specific lines as reviewed', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'abc', reviewed: false },
      { line: 2, model: 'claude-sonnet-4-20250514', promptHash: 'abc', reviewed: false },
    ], { cwd: repo.dir });

    markReviewed(repo.commitHash, 'hello.js', [1], { cwd: repo.dir });

    const result = getTrace(repo.commitHash, { cwd: repo.dir });
    assert.strictEqual(result['hello.js'][0].reviewed, true);
    assert.strictEqual(result['hello.js'][1].reviewed, false);
  });

  it('returns false for non-existent trace', () => {
    const result = markReviewed(repo.commitHash, 'nope.js', [1], { cwd: repo.dir });
    assert.strictEqual(result, false);
  });
});

describe('getTracedCommits', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('returns empty array when no traces exist', () => {
    const commits = getTracedCommits({ cwd: repo.dir });
    assert.deepStrictEqual(commits, []);
  });

  it('returns commit hashes after adding traces', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'abc' },
    ], { cwd: repo.dir });

    const commits = getTracedCommits({ cwd: repo.dir });
    assert.ok(commits.length >= 1);
    assert.ok(commits.includes(repo.commitHash));
  });
});

describe('updateTrace', () => {
  let repo;

  beforeEach(() => {
    repo = createTempGitRepo();
  });

  afterEach(() => {
    cleanup(repo.dir);
  });

  it('updates fields on all traces for a file', () => {
    addTrace(repo.commitHash, 'hello.js', [
      { line: 1, model: 'claude-sonnet-4-20250514', promptHash: 'abc', reviewed: false },
    ], { cwd: repo.dir });

    updateTrace(repo.commitHash, 'hello.js', { reviewed: true, model: 'claude-opus' }, { cwd: repo.dir });

    const result = getTrace(repo.commitHash, { cwd: repo.dir });
    assert.strictEqual(result['hello.js'][0].reviewed, true);
    assert.strictEqual(result['hello.js'][0].model, 'claude-opus');
  });

  it('returns false for non-existent file', () => {
    const result = updateTrace(repo.commitHash, 'nope.js', { reviewed: true }, { cwd: repo.dir });
    assert.strictEqual(result, false);
  });
});
