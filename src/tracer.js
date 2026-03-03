'use strict';

const { execSync } = require('child_process');

/**
 * tracer.js — AI provenance data storage via git-notes
 * 
 * Uses git-notes (refs/notes/ai-provenance) to store AI metadata
 * without polluting commit history.
 */

const NOTES_REF = 'refs/notes/ai-provenance';

/**
 * Add AI provenance trace for a commit
 * @param {string} commitHash 
 * @param {string} file - File path
 * @param {Array<{line: number, model: string, promptHash: string, reviewed: boolean}>} traces
 */
function addTrace(commitHash, file, traces) {
  const existing = getTrace(commitHash);
  const data = existing || {};
  
  if (!data[file]) data[file] = [];
  
  for (const trace of traces) {
    // Avoid duplicates
    const exists = data[file].some(t => t.line === trace.line);
    if (!exists) {
      data[file].push({
        line: trace.line,
        model: trace.model,
        promptHash: trace.promptHash,
        confidence: trace.confidence || 1.0,
        reviewed: trace.reviewed || false,
        timestamp: trace.timestamp || new Date().toISOString(),
      });
    }
  }

  const json = JSON.stringify(data);
  try {
    // Try to add note (will fail if note already exists)
    execSync(`git notes --ref=${NOTES_REF} add -f -m '${json.replace(/'/g, "\\'")}' ${commitHash}`, {
      stdio: 'ignore',
    });
  } catch {
    // Force overwrite
    execSync(`git notes --ref=${NOTES_REF} add -f -m '${json.replace(/'/g, "\\'")}' ${commitHash}`, {
      stdio: 'ignore',
    });
  }
}

/**
 * Get AI provenance trace for a commit
 * @param {string} commitHash
 * @returns {Object|null} - { "file.js": [{line, model, promptHash, reviewed, ...}] }
 */
function getTrace(commitHash) {
  try {
    const note = execSync(`git notes --ref=${NOTES_REF} show ${commitHash}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return JSON.parse(note.trim());
  } catch {
    return null;
  }
}

/**
 * Mark lines as reviewed
 * @param {string} commitHash
 * @param {string} file
 * @param {number[]} lines - Line numbers to mark as reviewed
 */
function markReviewed(commitHash, file, lines) {
  const data = getTrace(commitHash);
  if (!data || !data[file]) return false;

  for (const trace of data[file]) {
    if (lines.includes(trace.line)) {
      trace.reviewed = true;
    }
  }

  const json = JSON.stringify(data);
  execSync(`git notes --ref=${NOTES_REF} add -f -m '${json.replace(/'/g, "\\'")}' ${commitHash}`, {
    stdio: 'ignore',
  });
  return true;
}

/**
 * Get all commits with AI provenance notes
 * @returns {string[]} - Array of commit hashes
 */
function getTracedCommits() {
  try {
    const output = execSync(`git notes --ref=${NOTES_REF} list`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
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
  markReviewed,
  getTracedCommits,
  getFileProvenance,
};
