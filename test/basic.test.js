'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseArgs, VERSION } = require('../src/index.js');
const { lineSimilarity, hashString, detectAILines } = require('../src/detector.js');
const { POST_COMMIT_HOOK } = require('../src/hooks.js');

describe('parseArgs', () => {
  it('parses --version', () => {
    const args = parseArgs(['--version']);
    assert.strictEqual(args.version, true);
  });

  it('parses --help', () => {
    const args = parseArgs(['--help']);
    assert.strictEqual(args.help, true);
  });

  it('parses --init', () => {
    const args = parseArgs(['--init']);
    assert.strictEqual(args.command, 'init');
  });

  it('parses --stats', () => {
    const args = parseArgs(['--stats']);
    assert.strictEqual(args.command, 'stats');
  });

  it('parses --ci with threshold', () => {
    const args = parseArgs(['--ci', '--threshold', '30']);
    assert.strictEqual(args.command, 'ci');
    assert.strictEqual(args.threshold, 30);
  });

  it('parses file argument', () => {
    const args = parseArgs(['src/index.js']);
    assert.strictEqual(args.command, 'who');
    assert.strictEqual(args.file, 'src/index.js');
  });

  it('parses --json flag', () => {
    const args = parseArgs(['--stats', '--json']);
    assert.strictEqual(args.json, true);
  });

  it('parses --model filter', () => {
    const args = parseArgs(['src/index.js', '--model', 'claude-sonnet']);
    assert.strictEqual(args.model, 'claude-sonnet');
  });
});

describe('lineSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    assert.strictEqual(lineSimilarity('hello world', 'hello world'), 1.0);
  });

  it('returns 0 for empty strings', () => {
    assert.strictEqual(lineSimilarity('', 'hello'), 0);
    assert.strictEqual(lineSimilarity('hello', ''), 0);
  });

  it('returns high similarity for substrings', () => {
    const sim = lineSimilarity('const x = 1;', 'const x = 1; // comment');
    assert.ok(sim > 0.5);
  });

  it('returns low similarity for different strings', () => {
    const sim = lineSimilarity('function foo() {}', 'import bar from "baz"');
    assert.ok(sim < 0.5);
  });
});

describe('hashString', () => {
  it('returns consistent hash', () => {
    const h1 = hashString('test prompt');
    const h2 = hashString('test prompt');
    assert.strictEqual(h1, h2);
  });

  it('returns different hash for different strings', () => {
    const h1 = hashString('prompt a');
    const h2 = hashString('prompt b');
    assert.notStrictEqual(h1, h2);
  });

  it('returns 8-char hex string', () => {
    const h = hashString('anything');
    assert.ok(/^[0-9a-f]{8}$/.test(h));
  });
});

describe('detectAILines', () => {
  it('detects matching lines from sessions', () => {
    const diff = `@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+const z = 3;`;
    
    const sessions = [{
      model: 'claude-sonnet',
      prompt: 'add variables',
      promptHash: '12345678',
      code: ['const x = 1;', 'const y = 2;'],
    }];

    const results = detectAILines(diff, sessions);
    assert.ok(results.length >= 2);
    assert.strictEqual(results[0].model, 'claude-sonnet');
  });

  it('returns empty for no matches', () => {
    const diff = `@@ -0,0 +1,1 @@
+console.log("hello");`;
    
    const sessions = [{
      model: 'gpt-4o',
      prompt: 'test',
      promptHash: '00000000',
      code: ['totally different code'],
    }];

    const results = detectAILines(diff, sessions);
    assert.strictEqual(results.length, 0);
  });
});

describe('hooks', () => {
  it('POST_COMMIT_HOOK contains git-who', () => {
    assert.ok(POST_COMMIT_HOOK.includes('git-who'));
  });

  it('POST_COMMIT_HOOK starts with shebang', () => {
    assert.ok(POST_COMMIT_HOOK.startsWith('#!/bin/sh'));
  });
});

describe('VERSION', () => {
  it('is a valid semver', () => {
    assert.ok(/^\d+\.\d+\.\d+$/.test(VERSION));
  });
});
