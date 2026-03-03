'use strict';

const path = require('path');
const { execSync } = require('child_process');

/**
 * git-who: AI code provenance tracker
 * Main entry point — routes CLI commands to modules
 */

const VERSION = '0.1.0';

const HELP = `
\x1b[1mgit-who\x1b[0m v${VERSION} — git blame for AI

\x1b[1mUSAGE\x1b[0m
  git who <file>          Show AI provenance for each line
  git who --init          Install post-commit hook
  git who --stats         Show project-level AI code statistics
  git who --ci            CI mode (exit 1 if unreviewed AI code > threshold)
  git who --version       Show version
  git who --help          Show this help

\x1b[1mOPTIONS\x1b[0m
  --json                  Output in JSON format
  --model <name>          Filter by AI model
  --reviewed              Show only reviewed lines
  --unreviewed            Show only unreviewed lines
  --threshold <n>         CI mode: max % of unreviewed AI code (default: 20)

\x1b[1mEXAMPLES\x1b[0m
  git who src/index.js
  git who --stats --json
  git who --ci --threshold 10

\x1b[1mSUPPORTED AI TOOLS\x1b[0m
  • Claude Code (~/.claude/projects/*/session_*)
  • Cursor (.cursor/sessions/)
  • Generic git-trailers (AI-Model, AI-Prompt-Hash)
`;

function parseArgs(argv) {
  const args = {
    command: null,
    file: null,
    json: false,
    model: null,
    reviewed: null,
    threshold: 20,
    version: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--init':
        args.command = 'init';
        break;
      case '--stats':
        args.command = 'stats';
        break;
      case '--ci':
        args.command = 'ci';
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--reviewed':
        args.reviewed = true;
        break;
      case '--unreviewed':
        args.reviewed = false;
        break;
      case '--threshold':
        args.threshold = parseInt(argv[++i], 10);
        break;
      default:
        if (!arg.startsWith('-')) {
          args.command = 'who';
          args.file = arg;
        }
        break;
    }
  }

  return args;
}

function isGitRepo() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getGitRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}

async function main(argv) {
  const args = parseArgs(argv);

  if (args.version) {
    console.log(`git-who v${VERSION}`);
    return;
  }

  if (args.help || !args.command) {
    console.log(HELP);
    return;
  }

  if (!isGitRepo()) {
    throw new Error('Not a git repository. Run this command inside a git repo.');
  }

  const gitRoot = getGitRoot();

  switch (args.command) {
    case 'init': {
      const { initHooks } = require('./hooks.js');
      await initHooks(gitRoot);
      break;
    }
    case 'who': {
      const { showProvenance } = require('./reporter.js');
      await showProvenance(gitRoot, args.file, {
        json: args.json,
        model: args.model,
        reviewed: args.reviewed,
      });
      break;
    }
    case 'stats': {
      const { showStats } = require('./stats.js');
      await showStats(gitRoot, { json: args.json });
      break;
    }
    case 'ci': {
      const { ciCheck } = require('./stats.js');
      await ciCheck(gitRoot, { threshold: args.threshold });
      break;
    }
    default:
      console.log(HELP);
  }
}

module.exports = { main, parseArgs, isGitRepo, getGitRoot, VERSION };
