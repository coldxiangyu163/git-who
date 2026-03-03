'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getTracedCommits, getTrace } = require('./tracer.js');

/**
 * stats.js — Project-level AI code statistics & CI checks
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
  white: '\x1b[37m',
};

/**
 * Load .gitwhorc config from git root
 * @param {string} gitRoot
 * @returns {Object} config
 */
function loadConfig(gitRoot) {
  const defaults = {
    version: 1,
    adapters: ['claude', 'cursor'],
    ci: {
      threshold: 50,
      failOnUnreviewed: true,
    },
    ignore: ['node_modules/**', 'dist/**', '*.min.js'],
  };

  const configPath = path.join(gitRoot, '.gitwhorc');
  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      ci: { ...defaults.ci, ...(parsed.ci || {}) },
    };
  } catch {
    return defaults;
  }
}

/**
 * Gather project-wide statistics
 * @param {string} [gitRoot] - Git repo root (used for config loading)
 * @param {Object} [options] - { cwd }
 * @returns {Object} stats
 */
function gatherStats(gitRoot, options = {}) {
  const opts = options.cwd ? options : (gitRoot ? { cwd: gitRoot } : {});
  const commits = getTracedCommits(opts);

  const stats = {
    totalCommits: commits.length,
    totalFiles: 0,
    totalAILines: 0,
    reviewedLines: 0,
    unreviewedLines: 0,
    models: {},
    files: {},
    directories: {},
  };

  const fileSet = new Set();

  for (const commit of commits) {
    const data = getTrace(commit, opts);
    if (!data) continue;

    for (const [file, traces] of Object.entries(data)) {
      fileSet.add(file);

      if (!stats.files[file]) {
        stats.files[file] = { aiLines: 0, reviewed: 0, unreviewed: 0, models: {} };
      }

      // Directory-level aggregation
      const dir = path.dirname(file) || '.';
      if (!stats.directories[dir]) {
        stats.directories[dir] = { aiLines: 0, reviewed: 0, unreviewed: 0, files: new Set() };
      }
      stats.directories[dir].files.add(file);

      for (const trace of traces) {
        stats.totalAILines++;
        stats.files[file].aiLines++;
        stats.directories[dir].aiLines++;

        if (trace.reviewed) {
          stats.reviewedLines++;
          stats.files[file].reviewed++;
          stats.directories[dir].reviewed++;
        } else {
          stats.unreviewedLines++;
          stats.files[file].unreviewed++;
          stats.directories[dir].unreviewed++;
        }

        const model = trace.model || 'unknown';
        stats.models[model] = (stats.models[model] || 0) + 1;
        stats.files[file].models[model] = (stats.files[file].models[model] || 0) + 1;
      }
    }
  }

  stats.totalFiles = fileSet.size;

  // Convert directory file sets to counts for JSON serialization
  for (const [dir, data] of Object.entries(stats.directories)) {
    stats.directories[dir].fileCount = data.files.size;
    stats.directories[dir].files = [...data.files];
  }

  return stats;
}

/**
 * Compute total project lines (for AI code percentage)
 * @param {string} gitRoot
 * @returns {number}
 */
function countProjectLines(gitRoot) {
  try {
    const output = execSync(
      `git ls-files -- '*.js' '*.ts' '*.py' '*.go' '*.rs' '*.java' '*.rb' '*.c' '*.cpp' '*.h' | xargs wc -l 2>/dev/null | tail -1`,
      { encoding: 'utf-8', cwd: gitRoot, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const match = output.trim().match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Draw a horizontal bar
 */
function drawBar(value, maxValue, width = 20) {
  const filled = maxValue > 0 ? Math.max(1, Math.round((value / maxValue) * width)) : 0;
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/**
 * Show project statistics
 * @param {string} gitRoot
 * @param {Object} options - { json }
 */
async function showStats(gitRoot, options = {}) {
  const stats = gatherStats(gitRoot);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return stats;
  }

  if (stats.totalCommits === 0) {
    console.log(`\n  ${COLORS.dim}No AI provenance data found.${COLORS.reset}`);
    console.log(`  Run ${COLORS.cyan}git who --init${COLORS.reset} to start tracking.\n`);
    return stats;
  }

  const totalProjectLines = countProjectLines(gitRoot);
  const aiPct = totalProjectLines > 0
    ? Math.round((stats.totalAILines / totalProjectLines) * 100)
    : 0;
  const reviewRate = stats.totalAILines > 0
    ? Math.round((stats.reviewedLines / stats.totalAILines) * 100)
    : 0;

  // ── Header ──
  console.log(`\n${COLORS.bold}📊 git-who Statistics${COLORS.reset}`);
  console.log(`${COLORS.dim}${'═'.repeat(55)}${COLORS.reset}`);

  // ── Overview ──
  console.log(`${COLORS.bold}  Overview${COLORS.reset}`);
  console.log(`${COLORS.dim}  ${'─'.repeat(50)}${COLORS.reset}`);
  console.log(`  Tracked commits:      ${COLORS.cyan}${stats.totalCommits}${COLORS.reset}`);
  console.log(`  Files with AI code:   ${COLORS.cyan}${stats.totalFiles}${COLORS.reset}`);
  if (totalProjectLines > 0) {
    console.log(`  Total project lines:  ${COLORS.dim}${totalProjectLines}${COLORS.reset}`);
  }
  console.log(`  AI-generated lines:   ${COLORS.blue}${stats.totalAILines}${COLORS.reset}` +
    (aiPct > 0 ? ` (${aiPct}% of project)` : ''));
  console.log(`  Reviewed:             ${COLORS.green}${stats.reviewedLines}${COLORS.reset} (${reviewRate}%)`);
  console.log(`  Unreviewed:           ${COLORS.red}${stats.unreviewedLines}${COLORS.reset}`);

  // ── Review Coverage Bar ──
  console.log(`\n  Review coverage:`);
  const reviewBar = drawBar(stats.reviewedLines, stats.totalAILines, 30);
  console.log(`  ${COLORS.green}${reviewBar}${COLORS.reset} ${reviewRate}%`);

  // ── Model Distribution ──
  if (Object.keys(stats.models).length > 0) {
    console.log(`\n${COLORS.bold}  🤖 Model Distribution${COLORS.reset}`);
    console.log(`${COLORS.dim}  ${'─'.repeat(50)}${COLORS.reset}`);
    const sortedModels = Object.entries(stats.models).sort((a, b) => b[1] - a[1]);
    const maxModelLines = sortedModels[0]?.[1] || 1;
    for (const [model, count] of sortedModels) {
      const pct = Math.round((count / stats.totalAILines) * 100);
      const bar = drawBar(count, maxModelLines, 15);
      console.log(`  ${COLORS.cyan}${padRight(model, 24)}${COLORS.reset} ${bar} ${count} lines (${pct}%)`);
    }
  }

  // ── Top Files ──
  if (Object.keys(stats.files).length > 0) {
    console.log(`\n${COLORS.bold}  📁 Top Files by AI Lines${COLORS.reset}`);
    console.log(`${COLORS.dim}  ${'─'.repeat(50)}${COLORS.reset}`);
    const sortedFiles = Object.entries(stats.files)
      .sort((a, b) => b[1].aiLines - a[1].aiLines)
      .slice(0, 10);
    for (const [file, data] of sortedFiles) {
      const status = data.unreviewed > 0
        ? `${COLORS.red}${data.unreviewed} unreviewed${COLORS.reset}`
        : `${COLORS.green}all reviewed${COLORS.reset}`;
      console.log(`  ${padRight(truncate(file, 32), 34)} ${COLORS.blue}${padRight(data.aiLines + ' AI', 8)}${COLORS.reset} ${status}`);
    }
  }

  // ── Directory Summary ──
  if (Object.keys(stats.directories).length > 1) {
    console.log(`\n${COLORS.bold}  📂 Directory Summary${COLORS.reset}`);
    console.log(`${COLORS.dim}  ${'─'.repeat(50)}${COLORS.reset}`);
    const sortedDirs = Object.entries(stats.directories)
      .sort((a, b) => b[1].aiLines - a[1].aiLines)
      .slice(0, 8);
    for (const [dir, data] of sortedDirs) {
      const reviewPct = data.aiLines > 0
        ? Math.round((data.reviewed / data.aiLines) * 100)
        : 100;
      const color = reviewPct >= 80 ? COLORS.green : reviewPct >= 50 ? COLORS.yellow : COLORS.red;
      console.log(
        `  ${padRight(dir + '/', 24)} ` +
        `${COLORS.blue}${padRight(data.aiLines + ' AI', 8)}${COLORS.reset} ` +
        `${data.fileCount} files  ` +
        `${color}${reviewPct}% reviewed${COLORS.reset}`
      );
    }
  }

  console.log(`\n${COLORS.dim}${'═'.repeat(55)}${COLORS.reset}\n`);
  return stats;
}

/**
 * CI check — exit 1 if unreviewed AI code exceeds threshold
 * @param {string} gitRoot
 * @param {Object} options - { threshold, exitProcess }
 */
async function ciCheck(gitRoot, options = {}) {
  // Load config from .gitwhorc
  const config = loadConfig(gitRoot);

  // CLI option overrides config
  const threshold = options.threshold != null ? options.threshold : (config.ci?.threshold ?? 50);
  const shouldExit = options.exitProcess !== false;

  const stats = gatherStats(gitRoot);

  const result = {
    pass: true,
    totalAILines: stats.totalAILines,
    reviewedLines: stats.reviewedLines,
    unreviewedLines: stats.unreviewedLines,
    unreviewedPct: 0,
    threshold,
  };

  if (stats.totalAILines === 0) {
    result.message = 'No AI-generated code detected.';
    console.log(`${COLORS.green}✅ ${result.message}${COLORS.reset}`);
    if (shouldExit) process.exit(0);
    return result;
  }

  const unreviewedPct = Math.round((stats.unreviewedLines / stats.totalAILines) * 100);
  result.unreviewedPct = unreviewedPct;

  if (unreviewedPct > threshold) {
    result.pass = false;
    result.message = `${unreviewedPct}% of AI code is unreviewed (threshold: ${threshold}%)`;
    console.log(`${COLORS.red}✖ ${result.message}${COLORS.reset}`);
    console.log(`  Unreviewed: ${stats.unreviewedLines} / ${stats.totalAILines} AI lines`);

    // Show top offenders
    const offenders = Object.entries(stats.files)
      .filter(([, d]) => d.unreviewed > 0)
      .sort((a, b) => b[1].unreviewed - a[1].unreviewed)
      .slice(0, 5);
    if (offenders.length > 0) {
      console.log(`\n  Top unreviewed files:`);
      for (const [file, data] of offenders) {
        console.log(`    ${COLORS.red}${data.unreviewed}${COLORS.reset} unreviewed in ${file}`);
      }
    }

    if (shouldExit) process.exit(1);
    return result;
  } else {
    result.message = `${unreviewedPct}% of AI code is unreviewed (threshold: ${threshold}%)`;
    console.log(`${COLORS.green}✅ ${result.message}${COLORS.reset}`);
    if (shouldExit) process.exit(0);
    return result;
  }
}

function padRight(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

module.exports = {
  gatherStats,
  showStats,
  ciCheck,
  loadConfig,
  countProjectLines,
  drawBar,
  padRight,
  truncate,
};
