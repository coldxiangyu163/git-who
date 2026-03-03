'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * detector.js — AI code detection
 * 
 * Detects AI-generated code by analyzing:
 * 1. Claude Code session logs
 * 2. Cursor session logs
 * 3. Git trailers (AI-Model, AI-Prompt-Hash)
 */

/**
 * Supported AI tool adapters
 */
const ADAPTERS = {
  claude: {
    name: 'Claude Code',
    sessionDir: () => path.join(os.homedir(), '.claude', 'projects'),
    parseSession: parseClaude,
  },
  cursor: {
    name: 'Cursor',
    sessionDir: () => '.cursor/sessions',
    parseSession: parseCursor,
  },
};

/**
 * Parse Claude Code session log
 * @param {string} sessionPath - Path to session file
 * @returns {Array<{model: string, prompt: string, timestamp: string, code: string[]}>}
 */
function parseClaude(sessionPath) {
  const results = [];
  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const lines = content.split('\n');
    
    let currentModel = null;
    let currentPrompt = null;
    let currentCode = [];
    let inCodeBlock = false;

    for (const line of lines) {
      // Detect model usage
      const modelMatch = line.match(/model[:\s]+"?(claude-[\w.-]+|gpt-[\w.-]+|gemini-[\w.-]+)/i);
      if (modelMatch) {
        currentModel = modelMatch[1];
      }

      // Detect prompt
      const promptMatch = line.match(/(?:human|user|prompt)[:\s]+(.+)/i);
      if (promptMatch && !inCodeBlock) {
        currentPrompt = promptMatch[1].trim();
      }

      // Detect code blocks
      if (line.match(/^```/)) {
        if (inCodeBlock && currentCode.length > 0) {
          results.push({
            model: currentModel || 'unknown',
            prompt: currentPrompt || '',
            promptHash: hashString(currentPrompt || ''),
            timestamp: new Date().toISOString(),
            code: [...currentCode],
          });
          currentCode = [];
        }
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (inCodeBlock) {
        currentCode.push(line);
      }
    }

    return results;
  } catch {
    return results;
  }
}

/**
 * Parse Cursor session log (placeholder — format TBD)
 */
function parseCursor(sessionPath) {
  // Cursor session format is not publicly documented
  // This is a best-effort parser
  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const data = JSON.parse(content);
    return (data.interactions || []).map(i => ({
      model: i.model || 'cursor-unknown',
      prompt: i.prompt || '',
      promptHash: hashString(i.prompt || ''),
      timestamp: i.timestamp || new Date().toISOString(),
      code: (i.response || '').split('\n'),
    }));
  } catch {
    return [];
  }
}

/**
 * Parse git trailers from commit message
 * @param {string} commitHash
 * @returns {{model?: string, promptHash?: string, reviewed?: boolean}}
 */
function parseGitTrailers(commitHash) {
  try {
    const msg = execSync(`git log -1 --format=%B ${commitHash}`, { encoding: 'utf-8' });
    const trailers = {};
    
    const modelMatch = msg.match(/AI-Model:\s*(.+)/i);
    if (modelMatch) trailers.model = modelMatch[1].trim();
    
    const promptMatch = msg.match(/AI-Prompt-Hash:\s*(.+)/i);
    if (promptMatch) trailers.promptHash = promptMatch[1].trim();
    
    const reviewMatch = msg.match(/AI-Reviewed:\s*(true|false|yes|no)/i);
    if (reviewMatch) {
      trailers.reviewed = ['true', 'yes'].includes(reviewMatch[1].toLowerCase());
    }

    return Object.keys(trailers).length > 0 ? trailers : null;
  } catch {
    return null;
  }
}

/**
 * Detect AI-generated lines in a diff
 * @param {string} diff - Git diff output
 * @param {Array} sessions - Parsed session data
 * @returns {Array<{line: number, model: string, promptHash: string, confidence: number}>}
 */
function detectAILines(diff, sessions) {
  const results = [];
  const addedLines = [];
  
  // Extract added lines from diff
  let lineNum = 0;
  for (const line of diff.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      lineNum = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineNum++;
      addedLines.push({ lineNum, content: line.slice(1) });
    } else if (!line.startsWith('-')) {
      lineNum++;
    }
  }

  // Match added lines against session code
  for (const added of addedLines) {
    let bestMatch = null;
    let bestConfidence = 0;

    for (const session of sessions) {
      for (const codeLine of session.code) {
        const similarity = lineSimilarity(added.content.trim(), codeLine.trim());
        if (similarity > bestConfidence && similarity >= 0.8) {
          bestConfidence = similarity;
          bestMatch = session;
        }
      }
    }

    if (bestMatch) {
      results.push({
        line: added.lineNum,
        content: added.content,
        model: bestMatch.model,
        prompt: bestMatch.prompt,
        promptHash: bestMatch.promptHash,
        confidence: bestConfidence,
        reviewed: false,
      });
    }
  }

  return results;
}

/**
 * Simple line similarity (normalized Levenshtein-ish)
 */
function lineSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0;
  
  // Quick check: if one contains the other
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  // Token-based similarity
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Simple string hash
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Find all session logs for supported AI tools
 */
function findSessionLogs(gitRoot) {
  const logs = [];
  
  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    const dir = adapter.sessionDir();
    const fullDir = path.isAbsolute(dir) ? dir : path.join(gitRoot, dir);
    
    if (fs.existsSync(fullDir)) {
      const files = walkDir(fullDir).filter(f => 
        f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.log')
      );
      for (const file of files) {
        logs.push({ adapter: key, path: file });
      }
    }
  }
  
  return logs;
}

/**
 * Recursively walk directory
 */
function walkDir(dir, maxDepth = 3, depth = 0) {
  if (depth >= maxDepth) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(full, maxDepth, depth + 1));
      } else {
        results.push(full);
      }
    }
  } catch { /* ignore permission errors */ }
  return results;
}

/**
 * Extract metadata from a parsed session entry
 * @param {Object} session - Parsed session object
 * @returns {{model: string, promptHash: string, timestamp: string, linesCount: number}}
 */
function extractMetadata(session) {
  return {
    model: session.model || 'unknown',
    promptHash: session.promptHash || hashString(session.prompt || ''),
    timestamp: session.timestamp || new Date().toISOString(),
    linesCount: (session.code || []).length,
  };
}

/**
 * Unified detection entry point.
 * Runs all detectors against a commit and returns combined results.
 * @param {string} commitHash - Git commit hash
 * @param {Object} [options] - Options
 * @param {string} [options.cwd] - Working directory (git root)
 * @returns {{trailers: Object|null, sessions: Array, aiLines: Array}}
 */
function detect(commitHash, options = {}) {
  const cwd = options.cwd || process.cwd();
  const result = {
    commit: commitHash,
    trailers: null,
    sessions: [],
    aiLines: [],
  };

  // 1. Check git trailers
  try {
    result.trailers = parseGitTrailers(commitHash);
  } catch {
    // ignore — not in a git repo or commit not found
  }

  // 2. Find and parse session logs
  const logs = findSessionLogs(cwd);
  for (const log of logs) {
    const adapter = ADAPTERS[log.adapter];
    if (adapter) {
      const parsed = adapter.parseSession(log.path);
      result.sessions.push(...parsed);
    }
  }

  // 3. If we have sessions, try to match diff lines
  if (result.sessions.length > 0) {
    try {
      const diff = execSync(
        `git diff ${commitHash}^..${commitHash}`,
        { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
      );
      result.aiLines = detectAILines(diff, result.sessions);
    } catch {
      // First commit or other error — try diff against empty tree
      try {
        const diff = execSync(
          `git diff --root ${commitHash}`,
          { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
        );
        result.aiLines = detectAILines(diff, result.sessions);
      } catch {
        // ignore
      }
    }
  }

  return result;
}

module.exports = {
  ADAPTERS,
  parseClaude,
  parseCursor,
  parseGitTrailers,
  detectAILines,
  lineSimilarity,
  hashString,
  findSessionLogs,
  extractMetadata,
  detect,
};
