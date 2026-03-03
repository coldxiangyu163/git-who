'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getFileProvenance } = require('./tracer.js');

/**
 * reporter.js — AI provenance report for files
 * 
 * Shows line-by-line AI/Human attribution with color-coded output
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
};

/**
 * Show provenance for a file
 */
async function showProvenance(gitRoot, filePath, options = {}) {
  const fullPath = path.resolve(gitRoot, filePath);
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const lines = fileContent.split('\n');
  const provenance = getFileProvenance(filePath);

  // Build line map
  const lineMap = new Map();
  for (const p of provenance) {
    lineMap.set(p.line, p);
  }

  // Apply filters
  const filteredLines = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const prov = lineMap.get(lineNum);
    
    if (options.model && prov && prov.model !== options.model) continue;
    if (options.reviewed === true && (!prov || !prov.reviewed)) continue;
    if (options.reviewed === false && (!prov || prov.reviewed)) continue;

    filteredLines.push({ lineNum, content: lines[i], prov });
  }

  if (options.json) {
    const jsonOutput = filteredLines.map(l => ({
      line: l.lineNum,
      content: l.content,
      author: l.prov ? 'ai' : 'human',
      model: l.prov?.model || null,
      promptHash: l.prov?.promptHash || null,
      reviewed: l.prov?.reviewed || null,
      confidence: l.prov?.confidence || null,
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Header
  const totalLines = lines.length;
  const aiLines = provenance.length;
  const humanLines = totalLines - aiLines;
  const reviewedLines = provenance.filter(p => p.reviewed).length;

  console.log(`\n${COLORS.bold}${filePath}${COLORS.reset}`);
  console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`);
  console.log(
    `  👤 Human: ${COLORS.green}${humanLines}${COLORS.reset} lines` +
    `  |  🤖 AI: ${COLORS.blue}${aiLines}${COLORS.reset} lines` +
    `  |  ✅ Reviewed: ${COLORS.cyan}${reviewedLines}/${aiLines}${COLORS.reset}`
  );
  console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}\n`);

  // Group consecutive lines by author
  const groups = groupConsecutiveLines(filteredLines);

  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const range = first.lineNum === last.lineNum 
      ? `L${first.lineNum}` 
      : `L${first.lineNum}-${last.lineNum}`;

    if (first.prov) {
      const reviewed = first.prov.reviewed ? `${COLORS.green}✅${COLORS.reset}` : `${COLORS.red}❌${COLORS.reset}`;
      console.log(
        `  ${COLORS.blue}🤖 ${padRight(range, 12)}${COLORS.reset} ` +
        `${COLORS.cyan}${first.prov.model}${COLORS.reset}  ` +
        `${reviewed}  ` +
        `${COLORS.dim}#${first.prov.promptHash}${COLORS.reset}`
      );
    } else {
      console.log(
        `  ${COLORS.green}👤 ${padRight(range, 12)}${COLORS.reset} ` +
        `${COLORS.dim}Human${COLORS.reset}`
      );
    }
  }

  console.log('');
}

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

module.exports = { showProvenance };
