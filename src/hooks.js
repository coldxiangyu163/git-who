'use strict';

const fs = require('fs');
const path = require('path');

/**
 * hooks.js — Git hook installation for automatic AI code tracking
 */

const POST_COMMIT_HOOK = `#!/bin/sh
# git-who: auto-detect AI-generated code on commit
# Installed by: git who --init

if command -v git-who >/dev/null 2>&1; then
  git-who --detect-commit HEAD 2>/dev/null || true
fi
`;

/**
 * Install post-commit hook
 */
async function initHooks(gitRoot) {
  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');

  // Check if hooks dir exists
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Check for existing hook
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('git-who')) {
      console.log('  \x1b[33m⚠\x1b[0m  git-who hook already installed.');
      return;
    }
    // Append to existing hook
    fs.appendFileSync(hookPath, '\n' + POST_COMMIT_HOOK);
    console.log('  \x1b[32m✔\x1b[0m  Appended git-who to existing post-commit hook.');
  } else {
    fs.writeFileSync(hookPath, POST_COMMIT_HOOK);
    fs.chmodSync(hookPath, '755');
    console.log('  \x1b[32m✔\x1b[0m  Created post-commit hook.');
  }

  // Create .gitwhorc config
  const configPath = path.join(gitRoot, '.gitwhorc');
  if (!fs.existsSync(configPath)) {
    const config = {
      version: 1,
      adapters: ['claude', 'cursor'],
      ci: {
        threshold: 20,
        failOnUnreviewed: true,
      },
      ignore: ['node_modules/**', 'dist/**', '*.min.js'],
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  \x1b[32m✔\x1b[0m  Created .gitwhorc config.');
  }

  console.log('\n  \x1b[1mgit-who initialized!\x1b[0m');
  console.log('  AI code will be tracked automatically on each commit.');
  console.log('  Run \x1b[36mgit who --stats\x1b[0m to see statistics.\n');
}

module.exports = { initHooks, POST_COMMIT_HOOK };
