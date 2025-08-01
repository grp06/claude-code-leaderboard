import { readFile, writeFile, mkdir, chmod, access } from 'fs/promises';
import { constants, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { API_BASE_URL } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLAUDE_DIR = join(homedir(), '.claude');
const HOOK_SCRIPT_PATH = join(CLAUDE_DIR, 'count_tokens.js');
const SETTINGS_JSON_PATH = join(CLAUDE_DIR, 'settings.json');
const LEADERBOARD_CONFIG_PATH = join(CLAUDE_DIR, 'leaderboard.json');

// Get the bundled hook script path
const BUNDLED_HOOK_PATH = join(__dirname, '..', '..', 'hooks', 'count_tokens.js');

/**
 * Ensure the Claude directory exists
 */
async function ensureClaudeDir() {
  if (!existsSync(CLAUDE_DIR)) {
    await mkdir(CLAUDE_DIR, { recursive: true });
  }
}

/**
 * Check if a file is writable
 */
async function isWritable(filePath) {
  try {
    await access(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install or update the hook script
 */
async function installHookScript() {
  // Read the bundled hook script
  const hookContent = await readFile(BUNDLED_HOOK_PATH, 'utf-8');
  
  // Check if hook already exists and compare
  let shouldUpdate = true;
  if (existsSync(HOOK_SCRIPT_PATH)) {
    try {
      const existingContent = await readFile(HOOK_SCRIPT_PATH, 'utf-8');
      shouldUpdate = existingContent !== hookContent;
    } catch {
      // If we can't read it, we should update it
      shouldUpdate = true;
    }
  }
  
  if (shouldUpdate) {
    // Write the hook script
    await writeFile(HOOK_SCRIPT_PATH, hookContent, 'utf-8');
    
    // Make it executable
    await chmod(HOOK_SCRIPT_PATH, 0o755);
    
    return true; // Updated
  }
  
  return false; // Already up to date
}


/**
 * Update settings.json to include the hook
 */
async function updateSettingsJson() {
  let settings = {};
  
  // Read existing settings if they exist
  if (existsSync(SETTINGS_JSON_PATH)) {
    try {
      const content = await readFile(SETTINGS_JSON_PATH, 'utf-8');
      settings = JSON.parse(content);
    } catch (error) {
      console.warn('Warning: Could not parse existing settings.json, creating new one');
    }
  }
  
  // Ensure hooks structure exists
  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }
  
  // Check if our hook is already configured
  const hookExists = settings.hooks.Stop.some(stopHook => 
    stopHook.hooks?.some(hook => 
      hook.type === 'command' && 
      hook.command === HOOK_SCRIPT_PATH
    )
  );
  
  if (!hookExists) {
    // Add our hook
    settings.hooks.Stop.push({
      matcher: '.*',
      hooks: [{
        type: 'command',
        command: HOOK_SCRIPT_PATH
      }]
    });
    
    // Write updated settings
    await writeFile(SETTINGS_JSON_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    
    return true; // Updated
  }
  
  return false; // Already configured
}

/**
 * Create default leaderboard configuration
 */
async function createLeaderboardConfig() {
  if (!existsSync(LEADERBOARD_CONFIG_PATH)) {
    const defaultConfig = {
      twitterUrl: "@your_handle",
      endpoint: API_BASE_URL
    };
    
    await writeFile(LEADERBOARD_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return true; // Created
  }
  
  return false; // Already exists
}

/**
 * Main function to ensure hook is installed
 */
export async function ensureHookInstalled() {
  try {
    // Ensure Claude directory exists
    await ensureClaudeDir();
    
    // Track what was updated
    const updates = {
      hookScript: false,
      settingsJson: false,
      leaderboardConfig: false
    };
    
    // Install/update hook script
    updates.hookScript = await installHookScript();
    
    // Update settings file
    updates.settingsJson = await updateSettingsJson();
    
    // Create leaderboard config
    updates.leaderboardConfig = await createLeaderboardConfig();
    
    // Log installation status
    const wasUpdated = Object.values(updates).some(v => v);
    if (wasUpdated) {
      console.log('✅ Token tracking enabled');
      
      // Log what was updated (for debugging)
      const updatedItems = Object.entries(updates)
        .filter(([_, updated]) => updated)
        .map(([item, _]) => item);
      
      if (updatedItems.length > 0) {
        console.debug('Updated:', updatedItems.join(', '));
      }
    }
    
    return updates;
  } catch (error) {
    console.error('⚠️  Warning: Could not install token tracking hook:', error.message);
    // Don't throw - allow the CLI to continue even if hook installation fails
    return null;
  }
}

/**
 * Check if hook is installed and working
 */
export async function isHookInstalled() {
  try {
    // Check if all required files exist
    const filesExist = 
      existsSync(HOOK_SCRIPT_PATH) &&
      existsSync(SETTINGS_JSON_PATH) &&
      existsSync(LEADERBOARD_CONFIG_PATH);
    
    if (!filesExist) {
      return false;
    }
    
    // Check if hook is executable
    await access(HOOK_SCRIPT_PATH, constants.X_OK);
    
    return true;
  } catch {
    return false;
  }
}