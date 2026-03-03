'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getFileProvenance, getTracedCommits, getTrace } = require('./tracer.js');

/**
 * reporter.js — AI provenance report for files
 * 
 * Shows line-by-line AI/Human attribution with color-coded output.
 * Integrates git blame data for commit-level context.
 */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  white: '\x1b[37m',
};

/**
 * Parse git blame output for a file
 * @param {string} filePath - File path relative to git root
 * @param {Object} [options] - { cwd }
 * @returns {Array<{line: number, commit: string, author: string, date: string, content: string}>}
 */
function parseGitBlame(filePath, options = {}) {
  const results = [];
  try {
    const output = execSync(
      `git blame --porcelain ${escapeArg(filePath)}`,
      {
        encoding: 'utf-8',
        cwd: options.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );

    const lines = output.split('\n');
    let currentCommit = null;
    let currentAuthor = null;
    let currentDate = null;
    let currentLine = 0;

    for (const line of lines) {
      // First line of a blame entry: <hash> <orig_line> <final_line> [<num_lines>]
      const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
      if (headerMatch) {
        currentCommit = headerMatch[1];
        currentLine = parseInt(headerMatch[3], 10);
        continue;
      }

      const authorMatch = line.match(/^author (.+)/);
      if (authorMatch) {
        currentAuthor = authorMatch[1];
        continue;
      }

      const dateMatch = line.match(/^author-time (\d+)/);
      if (dateMatch) {
        currentDate = new Date(parseInt(dateMatch[1], 10) * 1000).toISOString().slice(0, 10);
        continue;
      }

      // Content line starts with \t
      if (line.startsWith('\t')) {
        results.push({
          line: currentLine,
          commit: currentCommit ? currentCommit.slice(0, 8) : '????????',
          author: currentAuthor || 'Unknown',
          date: currentDate || '',
          content: line.slice(1),
        });
      }
    }
  } catch {
    // Fallback: if git blame fails, return empty (file might be new/untracked)
  }
  return results;
}

/**
 * Escape argument for shell
 */
function escapeArg(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a provenance map for a file by scanning all traced commits
 * @param {string} filePath 
 * @param {Object} options - { cwd }
 * @returns {Map<number, {model: string, promptHash: string, reviewed: boolean, confidence: number, commit: string}>}
 */
function buildProvenanceMap(filePath, options = {}) {
  const lineMap = new Map();

  try {
    const provenance = getFileProvenance(filePath, options);
    for (const p of provenance) {
      lineMap.set(p.line, p);
    }
  } catch {
    // No provenance data available
  }

  return lineMap;
}

/**
 * Truncate a string to maxLen, adding ellipsis if needed
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Show provenance for a file
 * @param {string} gitRoot - Git repository root
 * @param {string} filePath - File path relative to git root
 * @param {Object} options - { json, model, reviewed }
 */
async function showProvenance(gitRoot, filePath, options = {}) {
  const fullPath = path.resolve(gitRoot, filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const lines = fileContent.split('\n');

  // Get provenance data
  const provenanceMap = buildProvenanceMap(filePath, { cwd: gitRoot });

  // Get git blame data
  const blameData = parseGitBlame(filePath, { cwd: gitRoot });
  const blameMap = new Map();
  for (const b of blameData) {
    blameMap.set(b.line, b);
  }

  // Build combined line data
  const allLines = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const prov = provenanceMap.get(lineNum);
    const blame = blameMap.get(lineNum);

    // Apply filters
    if (options.model && prov && prov.model !== options.model) continue;
    if (options.reviewed === true && (!prov || !prov.reviewed)) continue;
    if (options.reviewed === false && (!prov || prov.reviewed)) continue;

    allLines.push({
      lineNum,
      content: lines[i],
      prov: prov || null,
      blame: blame || null,
    });
  }

  // JSON output
  if (options.json) {
    const jsonOutput = allLines.map(l => ({
      line: l.lineNum,
      content: l.content,
      author: l.prov ? 'ai' : 'human',
      model: l.prov?.model || null,
      promptHash: l.prov?.promptHash || null,
      reviewed: l.prov?.reviewed ?? null,
      confidence: l.prov?.confidence ?? null,
      commit: l.blame?.commit || null,
      gitAuthor: l.blame?.author || null,
      date: l.blame?.date || null,
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return jsonOutput;
  }

  // Compute summary stats
  const totalLines = lines.length;
  const aiLineCount = [...provenanceMap.values()].length;
  const humanLineCount = totalLines - aiLineCount;
  const reviewedCount = [...provenanceMap.values()].filter(p => p.reviewed).length;

  // Header
  console.log(`\n${COLORS.bold}${filePath}${COLORS.reset}`);
  console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`);
  console.log(
    `  👤 Human: ${COLORS.green}${humanLineCount}${COLORS.reset} lines` +
    `  |  🤖 AI: ${COLORS.blue}${aiLineCount}${COLORS.reset} lines` +
    `  |  ✅ Reviewed: ${COLORS.cyan}${reviewedCount}/${aiLineCount}${COLORS.reset}`
  );
  console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}\n`);

  // Group consecutive lines by author type + model
  const groups = groupConsecutiveLines(allLines);

  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const range = first.lineNum === last.lineNum
      ? `L${first.lineNum}`
      : `L${first.lineNum}-${last.lineNum}`;

    if (first.prov) {
      const reviewed = first.prov.reviewed
        ? `${COLORS.green}✅${COLORS.reset}`
        : `${COLORS.red}❌${COLORS.reset}`;
      const model = first.prov.model || 'unknown';
      const promptHash = first.prov.promptHash || '';
      const commit = first.blame?.commit || '';
      const date = first.blame?.date || '';

      console.log(
        `  ${COLORS.blue}🤖 ${padRight(range, 12)}${COLORS.reset} ` +
        `${COLORS.cyan}${padRight(model, 22)}${COLORS.reset} ` +
        `${reviewed}  ` +
        `${COLORS.dim}#${truncate(promptHash, 8)}${COLORS.reset}` +
        (commit ? `  ${COLORS.dim}${commit} ${date}${COLORS.reset}` : '')
      );
    } else {
      const commit = first.blame?.commit || '';
      const author = first.blame?.author || '';
      const date = first.blame?.date || '';

      console.log(
        `  ${COLORS.green}👤 ${padRight(range, 12)}${COLORS.reset} ` +
        `${COLORS.dim}${padRight(truncate(author, 20) || 'Human', 22)}${COLORS.reset}` +
        (commit ? `       ${COLORS.dim}${commit} ${date}${COLORS.reset}` : '')
      );
    }
  }

  console.log('');
  return allLines;
}

/**
 * Group consecutive lines by same author type (human/ai) and same model
 */
function groupConsecutiveLines(lines) {
  const groups = [];
  let current = [];

  for (const line of lines) {
    if (current.length === 0) {
      current.push(line);
    } else {
      const prev = current[current.length - 1];
      const sameAuthor = (!!prev.prov) === (!!line.prov) &&
        (!prev.prov || prev.prov.model === line.prov?.model);

      if (sameAuthor && line.lineNum === prev.lineNum + 1) {
        current.push(line);
      } else {
        groups.push(current);
        current = [line];
      }
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function padRight(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

module.exports = {
  showProvenance,
  parseGitBlame,
  buildProvenanceMap,
  groupConsecutiveLines,
  padRight,
  truncate,
};
