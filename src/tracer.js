'use strict';

const { execSync } = require('child_process');

/**
 * tracer.js — AI provenance data storage via git-notes
 * 
 * Uses git-notes (refs/notes/ai-provenance) to store AI metadata
 * without polluting commit history.
 */

const NOTES_REF = 'refs/notes/git-who';

/**
 * Execute a git command, optionally in a specific directory
 */
function gitExec(cmd, options = {}) {
  const execOpts = { encoding: 'utf-8', ...options };
  if (options.cwd) {
    execOpts.cwd = options.cwd;
  }
  return execSync(cmd, execOpts);
}

/**
 * Write a note to git-notes, handling shell escaping safely
 */
function writeNote(commitHash, data, options = {}) {
  const json = JSON.stringify(data);
  // Use stdin to avoid shell escaping issues
  execSync(
    `git notes --ref=${NOTES_REF} add -f -m ${escapeShellArg(json)} ${commitHash}`,
    { stdio: 'ignore', ...(options.cwd ? { cwd: options.cwd } : {}) }
  );
}

/**
 * Escape a string for safe shell argument usage
 */
function escapeShellArg(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Add AI provenance trace for a commit
 * @param {string} commitHash 
 * @param {string} file - File path
 * @param {Object|Array} lineRangeOrTraces - Either { start, end } line range or array of trace objects
 * @param {Object} [metadata] - Metadata when using lineRange form: { model, prompt_hash, reviewed, timestamp }
 * @param {Object} [options] - Options (e.g. { cwd: '/path/to/repo' })
 */
function addTrace(commitHash, file, lineRangeOrTraces, metadata, options = {}) {
  // Normalize arguments: support both (commit, file, traces, options) and (commit, file, lineRange, metadata, options)
  let traces;
  let opts;

  if (Array.isArray(lineRangeOrTraces)) {
    // Legacy form: addTrace(commit, file, tracesArray, options)
    traces = lineRangeOrTraces;
    opts = metadata || {};
  } else if (lineRangeOrTraces && typeof lineRangeOrTraces === 'object' && ('start' in lineRangeOrTraces || 'line' in lineRangeOrTraces)) {
    // New form: addTrace(commit, file, lineRange, metadata, options)
    const meta = metadata || {};
    opts = options || {};
    if ('start' in lineRangeOrTraces && 'end' in lineRangeOrTraces) {
      // Line range — expand to individual trace entries
      traces = [];
      for (let line = lineRangeOrTraces.start; line <= lineRangeOrTraces.end; line++) {
        traces.push({
          line,
          model: meta.model || 'unknown',
          promptHash: meta.prompt_hash || meta.promptHash || '',
          confidence: meta.confidence || 1.0,
          reviewed: meta.reviewed || false,
          timestamp: meta.timestamp || new Date().toISOString(),
        });
      }
    } else {
      // Single line object
      traces = [{
        line: lineRangeOrTraces.line,
        model: meta.model || 'unknown',
        promptHash: meta.prompt_hash || meta.promptHash || '',
        confidence: meta.confidence || 1.0,
        reviewed: meta.reviewed || false,
        timestamp: meta.timestamp || new Date().toISOString(),
      }];
    }
  } else {
    // Fallback: treat as traces array
    traces = lineRangeOrTraces || [];
    opts = metadata || {};
  }

  const existing = getTrace(commitHash, opts);
  const data = existing || {};
  
  if (!data[file]) data[file] = [];
  
  for (const trace of traces) {
    // Avoid duplicates
    const exists = data[file].some(t => t.line === trace.line);
    if (!exists) {
      data[file].push({
        line: trace.line,
        model: trace.model,
        promptHash: trace.promptHash || trace.prompt_hash || '',
        confidence: trace.confidence || 1.0,
        reviewed: trace.reviewed || false,
        timestamp: trace.timestamp || new Date().toISOString(),
      });
    }
  }

  writeNote(commitHash, data, opts);
}

/**
 * Get AI provenance trace for a commit
 * @param {string} commitHash
 * @param {Object} [options] - Options (e.g. { cwd: '/path/to/repo' })
 * @returns {Object|null} - { "file.js": [{line, model, promptHash, reviewed, ...}] }
 */
function getTrace(commitHash, options = {}) {
  try {
    const note = execSync(`git notes --ref=${NOTES_REF} show ${commitHash}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    return JSON.parse(note.trim());
  } catch {
    return null;
  }
}

/**
 * Get all traces for a commit (alias with file filter)
 * @param {string} commitHash
 * @param {string} [file] - Optional file filter
 * @param {Object} [options] - Options
 * @returns {Object|null}
 */
function getAllTraces(commitHash, file, options = {}) {
  const data = getTrace(commitHash, options);
  if (!data) return null;
  if (file) {
    return data[file] ? { [file]: data[file] } : null;
  }
  return data;
}

/**
 * Mark lines as reviewed
 * @param {string} commitHash
 * @param {string} file
 * @param {number[]} lines - Line numbers to mark as reviewed
 * @param {Object} [options]
 */
function markReviewed(commitHash, file, lines, options = {}) {
  const data = getTrace(commitHash, options);
  if (!data || !data[file]) return false;

  for (const trace of data[file]) {
    if (lines.includes(trace.line)) {
      trace.reviewed = true;
    }
  }

  writeNote(commitHash, data, options);
  return true;
}

/**
 * Update trace entries for a commit/file with arbitrary updates
 * @param {string} commitHash
 * @param {string} file
 * @param {Object} updates - Fields to update (applied to all matching traces)
 * @param {Object} [options]
 * @returns {boolean}
 */
function updateTrace(commitHash, file, updates, options = {}) {
  const data = getTrace(commitHash, options);
  if (!data || !data[file]) return false;

  for (const trace of data[file]) {
    for (const [key, value] of Object.entries(updates)) {
      trace[key] = value;
    }
  }

  writeNote(commitHash, data, options);
  return true;
}

/**
 * Get all commits with AI provenance notes
 * @param {Object} [options]
 * @returns {string[]} - Array of commit hashes
 */
function getTracedCommits(options = {}) {
  try {
    const output = execSync(`git notes --ref=${NOTES_REF} list`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    return output.trim().split('\n')
      .filter(Boolean)
      .map(line => line.split(' ')[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get aggregated provenance for a file across all commits
 * @param {string} file - File path relative to git root
 * @returns {Array<{line: number, model: string, promptHash: string, reviewed: boolean, commit: string}>}
 */
function getFileProvenance(file) {
  const commits = getTracedCommits();
  const results = [];

  for (const commit of commits) {
    const data = getTrace(commit);
    if (data && data[file]) {
      for (const trace of data[file]) {
        results.push({ ...trace, commit });
      }
    }
  }

  // Sort by line number, keep latest commit for each line
  const lineMap = new Map();
  for (const r of results) {
    const existing = lineMap.get(r.line);
    if (!existing) {
      lineMap.set(r.line, r);
    }
  }

  return Array.from(lineMap.values()).sort((a, b) => a.line - b.line);
}

module.exports = {
  NOTES_REF,
  addTrace,
  getTrace,
  getAllTraces,
  markReviewed,
  updateTrace,
  getTracedCommits,
  getFileProvenance,
  escapeShellArg,
};
