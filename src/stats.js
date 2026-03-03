'use strict';

const { execSync } = require('child_process');
const { getTracedCommits, getTrace } = require('./tracer.js');

/**
 * stats.js — Project-level AI code statistics
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
 * Gather project-wide statistics
 */
function gatherStats(gitRoot) {
  const commits = getTracedCommits();
  
  const stats = {
    totalCommits: commits.length,
    totalFiles: new Set(),
    totalAILines: 0,
    reviewedLines: 0,
    unreviewedLines: 0,
    models: {},
    files: {},
  };

  for (const commit of commits) {
    const data = getTrace(commit);
    if (!data) continue;

    for (const [file, traces] of Object.entries(data)) {
      stats.totalFiles.add(file);
      
      if (!stats.files[file]) {
        stats.files[file] = { aiLines: 0, reviewed: 0, unreviewed: 0 };
      }

      for (const trace of traces) {
        stats.totalAILines++;
        stats.files[file].aiLines++;

        if (trace.reviewed) {
          stats.reviewedLines++;
          stats.files[file].reviewed++;
        } else {
          stats.unreviewedLines++;
          stats.files[file].unreviewed++;
        }

        const model = trace.model || 'unknown';
        stats.models[model] = (stats.models[model] || 0) + 1;
      }
    }
  }

  stats.totalFiles = stats.totalFiles.size;
  return stats;
}

/**
 * Show project statistics
 */
async function showStats(gitRoot, options = {}) {
  const stats = gatherStats(gitRoot);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  if (stats.totalCommits === 0) {
    console.log(`\n  ${COLORS.dim}No AI provenance data found.${COLORS.reset}`);
    console.log(`  Run ${COLORS.cyan}git who --init${COLORS.reset} to start tracking.\n`);
    return;
  }

  const reviewRate = stats.totalAILines > 0 
    ? Math.round((stats.reviewedLines / stats.totalAILines) * 100) 
    : 0;

  console.log(`\n${COLORS.bold}📊 git-who Statistics${COLORS.reset}`);
  console.log(`${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`);
  console.log(`  Tracked commits:    ${COLORS.cyan}${stats.totalCommits}${COLORS.reset}`);
  console.log(`  Files with AI code: ${COLORS.cyan}${stats.totalFiles}${COLORS.reset}`);
  console.log(`  AI-generated lines: ${COLORS.blue}${stats.totalAILines}${COLORS.reset}`);
  console.log(`  Reviewed:           ${COLORS.green}${stats.reviewedLines}${COLORS.reset} (${reviewRate}%)`);
  console.log(`  Unreviewed:         ${COLORS.red}${stats.unreviewedLines}${COLORS.reset}`);
  
  // Model breakdown
  if (Object.keys(stats.models).length > 0) {
    console.log(`\n${COLORS.bold}  Models:${COLORS.reset}`);
    const sorted = Object.entries(stats.models).sort((a, b) => b[1] - a[1]);
    for (const [model, count] of sorted) {
      const pct = Math.round((count / stats.totalAILines) * 100);
      const bar = '█'.repeat(Math.max(1, Math.round(pct / 5)));
      console.log(`    ${COLORS.cyan}${padRight(model, 20)}${COLORS.reset} ${bar} ${count} (${pct}%)`);
    }
  }

  // Top files
  if (Object.keys(stats.files).length > 0) {
    console.log(`\n${COLORS.bold}  Top files:${COLORS.reset}`);
    const sorted = Object.entries(stats.files)
      .sort((a, b) => b[1].aiLines - a[1].aiLines)
      .slice(0, 10);
    for (const [file, data] of sorted) {
      const status = data.unreviewed > 0 
        ? `${COLORS.red}${data.unreviewed} unreviewed${COLORS.reset}` 
        : `${COLORS.green}all reviewed${COLORS.reset}`;
      console.log(`    ${padRight(file, 30)} ${COLORS.blue}${data.aiLines} AI lines${COLORS.reset}  ${status}`);
    }
  }

  console.log('');
}

/**
 * CI check — exit 1 if unreviewed AI code exceeds threshold
 */
async function ciCheck(gitRoot, options = {}) {
  const stats = gatherStats(gitRoot);
  const threshold = options.threshold || 20;

  if (stats.totalAILines === 0) {
    console.log('✅ No AI-generated code detected.');
    process.exit(0);
  }

  const unreviewedPct = Math.round((stats.unreviewedLines / stats.totalAILines) * 100);

  if (unreviewedPct > threshold) {
    console.log(`\x1b[31m✖ ${unreviewedPct}% of AI code is unreviewed (threshold: ${threshold}%)\x1b[0m`);
    console.log(`  Unreviewed: ${stats.unreviewedLines} / ${stats.totalAILines} AI lines`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m✅ ${unreviewedPct}% of AI code is unreviewed (threshold: ${threshold}%)\x1b[0m`);
    process.exit(0);
  }
}

function padRight(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

module.exports = { gatherStats, showStats, ciCheck };
