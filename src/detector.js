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
 * Detect AI code via Claude Code session logs.
 * Scans ~/.claude/projects for session files that match the commit time window.
 * @param {string} commitHash - Git commit hash
 * @param {Object} [options] - { cwd }
 * @returns {{ isAI: boolean, tool: string|null, model: string|null, confidence: number, metadata: Object }}
 */
function detectClaudeCode(commitHash, options = {}) {
  const cwd = options.cwd || process.cwd();
  const result = { isAI: false, tool: null, model: null, confidence: 0, metadata: {} };

  try {
    // Get commit timestamp for time-window matching
    const commitTime = execSync(
      `git log -1 --format=%ct ${commitHash}`,
      { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    const commitEpoch = parseInt(commitTime, 10);
    const windowSecs = 600; // 10-minute window

    const claudeDir = ADAPTERS.claude.sessionDir();
    if (!fs.existsSync(claudeDir)) return result;

    const sessionFiles = walkDir(claudeDir).filter(f =>
      f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.log')
    );

    let allSessions = [];
    for (const file of sessionFiles) {
      // Check file mtime within window of commit time
      try {
        const stat = fs.statSync(file);
        const fileMtime = Math.floor(stat.mtimeMs / 1000);
        if (Math.abs(fileMtime - commitEpoch) <= windowSecs) {
          const parsed = parseClaude(file);
          allSessions.push(...parsed);
        }
      } catch { /* skip unreadable files */ }
    }

    if (allSessions.length > 0) {
      // Try to match diff lines
      let diff = '';
      try {
        diff = execSync(
          `git diff ${commitHash}^..${commitHash}`,
          { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
        );
      } catch {
        try {
          diff = execSync(
            `git diff --root ${commitHash}`,
            { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
          );
        } catch { /* ignore */ }
      }

      const aiLines = diff ? detectAILines(diff, allSessions) : [];
      if (aiLines.length > 0) {
        const bestLine = aiLines.reduce((a, b) => a.confidence > b.confidence ? a : b);
        result.isAI = true;
        result.tool = 'Claude Code';
        result.model = bestLine.model;
        result.confidence = bestLine.confidence;
        result.metadata = {
          matchedLines: aiLines.length,
          sessions: allSessions.length,
          promptHash: bestLine.promptHash,
        };
      }
    }
  } catch { /* graceful degradation */ }

  return result;
}

/**
 * Detect AI code via Cursor session logs.
 * Scans .cursor/sessions in the project root.
 * @param {string} commitHash - Git commit hash
 * @param {Object} [options] - { cwd }
 * @returns {{ isAI: boolean, tool: string|null, model: string|null, confidence: number, metadata: Object }}
 */
function detectCursor(commitHash, options = {}) {
  const cwd = options.cwd || process.cwd();
  const result = { isAI: false, tool: null, model: null, confidence: 0, metadata: {} };

  try {
    const cursorDir = path.join(cwd, ADAPTERS.cursor.sessionDir());
    if (!fs.existsSync(cursorDir)) return result;

    const sessionFiles = walkDir(cursorDir).filter(f =>
      f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.log')
    );

    let allSessions = [];
    for (const file of sessionFiles) {
      const parsed = parseCursor(file);
      allSessions.push(...parsed);
    }

    if (allSessions.length > 0) {
      let diff = '';
      try {
        diff = execSync(
          `git diff ${commitHash}^..${commitHash}`,
          { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
        );
      } catch {
        try {
          diff = execSync(
            `git diff --root ${commitHash}`,
            { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'ignore'] }
          );
        } catch { /* ignore */ }
      }

      const aiLines = diff ? detectAILines(diff, allSessions) : [];
      if (aiLines.length > 0) {
        const bestLine = aiLines.reduce((a, b) => a.confidence > b.confidence ? a : b);
        result.isAI = true;
        result.tool = 'Cursor';
        result.model = bestLine.model;
        result.confidence = bestLine.confidence;
        result.metadata = {
          matchedLines: aiLines.length,
          sessions: allSessions.length,
          promptHash: bestLine.promptHash,
        };
      }
    }
  } catch { /* graceful degradation */ }

  return result;
}

/**
 * Detect AI code via git commit trailers (AI-Model, AI-Prompt-Hash, AI-Generated-By, etc.)
 * @param {string} commitHash - Git commit hash
 * @param {Object} [options] - { cwd }
 * @returns {{ isAI: boolean, tool: string|null, model: string|null, confidence: number, metadata: Object }}
 */
function detectGitTrailers(commitHash, options = {}) {
  const cwd = options.cwd || process.cwd();
  const result = { isAI: false, tool: null, model: null, confidence: 0, metadata: {} };

  try {
    const msg = execSync(`git log -1 --format=%B ${commitHash}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const trailers = {};

    // Standard trailers
    const modelMatch = msg.match(/AI-Model:\s*(.+)/i);
    if (modelMatch) trailers.model = modelMatch[1].trim();

    const promptMatch = msg.match(/AI-Prompt-Hash:\s*(.+)/i);
    if (promptMatch) trailers.promptHash = promptMatch[1].trim();

    const reviewMatch = msg.match(/AI-Reviewed:\s*(true|false|yes|no)/i);
    if (reviewMatch) {
      trailers.reviewed = ['true', 'yes'].includes(reviewMatch[1].toLowerCase());
    }

    // AI-Generated-By trailer (e.g. "AI-Generated-By: Claude Code")
    const generatedByMatch = msg.match(/AI-Generated-By:\s*(.+)/i);
    if (generatedByMatch) trailers.generatedBy = generatedByMatch[1].trim();

    // Co-authored-by with AI indicators
    const coauthorMatch = msg.match(/Co-authored-by:\s*(.*(?:claude|cursor|copilot|ai|gpt|gemini).*)/i);
    if (coauthorMatch) trailers.coauthor = coauthorMatch[1].trim();

    if (Object.keys(trailers).length > 0) {
      result.isAI = true;
      result.tool = trailers.generatedBy || trailers.coauthor || 'unknown';
      result.model = trailers.model || null;
      result.confidence = trailers.model ? 0.95 : 0.7;
      result.metadata = trailers;
    }
  } catch { /* graceful degradation */ }

  return result;
}

/**
 * Unified detection entry point.
 * Runs all detectors against a commit and returns combined results.
 * @param {string} commitHash - Git commit hash
 * @param {Object} [options] - Options
 * @param {string} [options.cwd] - Working directory (git root)
 * @returns {{ isAI: boolean, tool: string|null, model: string|null, confidence: number, metadata: Object, details: Object }}
 */
function detect(commitHash, options = {}) {
  const cwd = options.cwd || process.cwd();

  // Run all three detectors
  const trailerResult = detectGitTrailers(commitHash, { cwd });
  const claudeResult = detectClaudeCode(commitHash, { cwd });
  const cursorResult = detectCursor(commitHash, { cwd });

  // Pick the highest-confidence result
  const candidates = [trailerResult, claudeResult, cursorResult].filter(r => r.isAI);

  if (candidates.length === 0) {
    return {
      isAI: false,
      tool: null,
      model: null,
      confidence: 0,
      metadata: {},
      details: {
        trailers: trailerResult,
        claudeCode: claudeResult,
        cursor: cursorResult,
      },
    };
  }

  const best = candidates.reduce((a, b) => a.confidence > b.confidence ? a : b);
  return {
    isAI: true,
    tool: best.tool,
    model: best.model,
    confidence: best.confidence,
    metadata: best.metadata,
    details: {
      trailers: trailerResult,
      claudeCode: claudeResult,
      cursor: cursorResult,
    },
  };
}

module.exports = {
  ADAPTERS,
  parseClaude,
  parseCursor,
  parseGitTrailers,
  detectClaudeCode,
  detectCursor,
  detectGitTrailers,
  detectAILines,
  lineSimilarity,
  hashString,
  findSessionLogs,
  extractMetadata,
  detect,
};
