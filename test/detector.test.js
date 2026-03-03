'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  parseClaude,
  parseCursor,
  parseGitTrailers,
  detectAILines,
  lineSimilarity,
  hashString,
  extractMetadata,
  detect,
  findSessionLogs,
} = require('../src/detector.js');

/**
 * Helper: create a temp directory with files
 */
function createTempDir(prefix = 'gitwho-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

describe('parseClaude', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('parses a session log with model and code blocks', () => {
    const sessionFile = path.join(tmpDir, 'session_001.log');
    fs.writeFileSync(sessionFile, [
      'model: "claude-sonnet-4-20250514"',
      'human: Write a hello world function',
      '```',
      'function hello() {',
      '  console.log("Hello, world!");',
      '}',
      '```',
    ].join('\n'));

    const results = parseClaude(sessionFile);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].model, 'claude-sonnet-4-20250514');
    assert.strictEqual(results[0].code.length, 3);
    assert.ok(results[0].code[0].includes('function hello'));
    assert.ok(results[0].promptHash.length > 0);
  });

  it('handles multiple code blocks in one session', () => {
    const sessionFile = path.join(tmpDir, 'session_002.log');
    fs.writeFileSync(sessionFile, [
      'model: "claude-sonnet-4-20250514"',
      'human: Write two functions',
      '```',
      'function a() { return 1; }',
      '```',
      'human: Another function',
      '```',
      'function b() { return 2; }',
      '```',
    ].join('\n'));

    const results = parseClaude(sessionFile);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].code[0], 'function a() { return 1; }');
    assert.strictEqual(results[1].code[0], 'function b() { return 2; }');
  });

  it('returns empty array for non-existent file', () => {
    const results = parseClaude('/nonexistent/path/session.log');
    assert.deepStrictEqual(results, []);
  });

  it('returns empty array for file with no code blocks', () => {
    const sessionFile = path.join(tmpDir, 'session_empty.log');
    fs.writeFileSync(sessionFile, 'Just some text without any code blocks\n');

    const results = parseClaude(sessionFile);
    assert.strictEqual(results.length, 0);
  });

  it('detects GPT model names', () => {
    const sessionFile = path.join(tmpDir, 'session_gpt.log');
    fs.writeFileSync(sessionFile, [
      'model: "gpt-4o"',
      '```',
      'const x = 42;',
      '```',
    ].join('\n'));

    const results = parseClaude(sessionFile);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].model, 'gpt-4o');
  });
});

describe('parseCursor', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('parses a JSON session with interactions', () => {
    const sessionFile = path.join(tmpDir, 'session.json');
    fs.writeFileSync(sessionFile, JSON.stringify({
      interactions: [
        {
          model: 'gpt-4o',
          prompt: 'Create a utility function',
          timestamp: '2026-03-01T10:00:00Z',
          response: 'function util() {\n  return true;\n}',
        },
      ],
    }));

    const results = parseCursor(sessionFile);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].model, 'gpt-4o');
    assert.strictEqual(results[0].code.length, 3);
  });

  it('returns empty array for invalid JSON', () => {
    const sessionFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(sessionFile, 'not valid json{{{');

    const results = parseCursor(sessionFile);
    assert.deepStrictEqual(results, []);
  });

  it('returns empty array for non-existent file', () => {
    const results = parseCursor('/nonexistent/cursor/session.json');
    assert.deepStrictEqual(results, []);
  });

  it('handles session with no interactions array', () => {
    const sessionFile = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(sessionFile, JSON.stringify({ version: 1 }));

    const results = parseCursor(sessionFile);
    assert.deepStrictEqual(results, []);
  });
});

describe('detectAILines (advanced)', () => {
  it('correctly maps line numbers from diff hunks', () => {
    const diff = [
      '@@ -10,3 +10,5 @@',
      ' existing line',
      '+const added1 = true;',
      '+const added2 = false;',
      ' another existing',
      '+const added3 = null;',
    ].join('\n');

    const sessions = [{
      model: 'claude-sonnet-4-20250514',
      prompt: 'add constants',
      promptHash: 'aabb1122',
      code: ['const added1 = true;', 'const added2 = false;', 'const added3 = null;'],
    }];

    const results = detectAILines(diff, sessions);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].line, 11);
    assert.strictEqual(results[1].line, 12);
    assert.strictEqual(results[2].line, 14);
  });

  it('handles multiple hunks in same diff', () => {
    const diff = [
      '@@ -1,3 +1,4 @@',
      '+const top = 1;',
      ' middle',
      ' middle2',
      ' middle3',
      '@@ -20,2 +21,3 @@',
      ' existing',
      '+const bottom = 2;',
    ].join('\n');

    const sessions = [{
      model: 'gemini-2.0',
      prompt: 'add lines',
      promptHash: 'ccdd3344',
      code: ['const top = 1;', 'const bottom = 2;'],
    }];

    const results = detectAILines(diff, sessions);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].line, 1);
    assert.strictEqual(results[0].model, 'gemini-2.0');
  });

  it('ignores deleted lines', () => {
    const diff = [
      '@@ -1,3 +1,2 @@',
      '-const removed = true;',
      ' kept line',
      ' another kept',
    ].join('\n');

    const sessions = [{
      model: 'claude-sonnet-4-20250514',
      prompt: 'test',
      promptHash: '00000000',
      code: ['const removed = true;'],
    }];

    const results = detectAILines(diff, sessions);
    assert.strictEqual(results.length, 0);
  });
});

describe('extractMetadata', () => {
  it('extracts metadata from a session object', () => {
    const session = {
      model: 'claude-sonnet-4-20250514',
      prompt: 'Write a function',
      promptHash: 'abcd1234',
      timestamp: '2026-03-01T10:00:00Z',
      code: ['line1', 'line2', 'line3'],
    };

    const meta = extractMetadata(session);
    assert.strictEqual(meta.model, 'claude-sonnet-4-20250514');
    assert.strictEqual(meta.promptHash, 'abcd1234');
    assert.strictEqual(meta.timestamp, '2026-03-01T10:00:00Z');
    assert.strictEqual(meta.linesCount, 3);
  });

  it('provides defaults for missing fields', () => {
    const meta = extractMetadata({});
    assert.strictEqual(meta.model, 'unknown');
    assert.ok(meta.promptHash.length > 0);
    assert.ok(meta.timestamp.length > 0);
    assert.strictEqual(meta.linesCount, 0);
  });

  it('computes promptHash from prompt if not provided', () => {
    const meta = extractMetadata({ prompt: 'test prompt' });
    const expected = hashString('test prompt');
    assert.strictEqual(meta.promptHash, expected);
  });
});

describe('lineSimilarity (edge cases)', () => {
  it('handles single-token strings', () => {
    const sim = lineSimilarity('hello', 'hello');
    assert.strictEqual(sim, 1.0);
  });

  it('handles whitespace-only strings', () => {
    const sim = lineSimilarity('   ', '   ');
    assert.strictEqual(sim, 1.0);
  });

  it('returns containment ratio for substrings', () => {
    const sim = lineSimilarity('ab', 'abcd');
    assert.ok(sim >= 0.5);
  });
});

describe('findSessionLogs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('finds .cursor/sessions/ logs in project root', () => {
    const cursorDir = path.join(tmpDir, '.cursor', 'sessions');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'session1.json'), '{}');
    fs.writeFileSync(path.join(cursorDir, 'session2.log'), 'log');

    const logs = findSessionLogs(tmpDir);
    const cursorLogs = logs.filter(l => l.adapter === 'cursor');
    assert.ok(cursorLogs.length >= 2);
  });

  it('returns empty for project with no session logs', () => {
    const logs = findSessionLogs(tmpDir);
    // Only check relative-path adapters (cursor). Claude uses absolute ~/.claude path
    // which may exist on dev machines.
    const cursorLogs = logs.filter(l => l.adapter === 'cursor');
    assert.strictEqual(cursorLogs.length, 0);
  });
});
