import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, checkAuthStatus } from '../utils/config.js';
import { startOAuth1aFlow } from '../auth/oauth1a.js';
import { storeOAuth1aTokens } from '../auth/tokens.js';

export async function authCommand(options = {}) {
  const { force = false } = options;
  
  console.log(chalk.blue('🔐 Twitter Authentication'));
  console.log(chalk.gray('━'.repeat(30)));
  
  // Check if already authenticated
  const authStatus = await checkAuthStatus();
  
  if (authStatus.isAuthenticated && !force) {
    console.log(chalk.green('✅ Already authenticated as'), chalk.cyan(authStatus.twitterHandle));
    console.log(chalk.gray(`Last authenticated: ${authStatus.lastAuthenticated}`));
    
    const { reauth } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reauth',
        message: 'Do you want to re-authenticate?',
        default: false
      }
    ]);
    
    if (!reauth) {
      console.log(chalk.yellow('Authentication cancelled'));
      console.log(chalk.gray('Use --force flag to skip this prompt'));
      return;
    }
  } else if (force && authStatus.isAuthenticated) {
    console.log(chalk.yellow('🔄 Force re-authentication requested'));
    console.log(chalk.gray('Current authentication will be replaced'));
  }
  
  console.log();
  console.log(chalk.yellow('🔐 Authentication Required'));
  console.log(chalk.gray('To track your usage and join the leaderboard, you need to authenticate with Twitter.'));
  console.log();
  
  try {
    console.log(chalk.blue('📱 Starting Twitter authentication (OAuth 1.0a)...'));
    
    // Start OAuth 1.0a flow
    const authResult = await startOAuth1aFlow();
    
    if (authResult.success) {
      // Update configuration with auth data
      const config = await loadConfig();
      
      config.twitterUrl = `@${authResult.username}`;
      config.twitterUserId = authResult.userId;
      config.lastAuthenticated = new Date().toISOString();
      
      // Store OAuth 1.0a tokens
      config.oauthVersion = '1.0a';
      await saveConfig(config);
      await storeOAuth1aTokens(authResult.oauth_token, authResult.oauth_token_secret);
      
      console.log();
      console.log(chalk.green('✅ Authentication successful!'));
      console.log(chalk.green(`👋 Welcome ${chalk.cyan(authResult.displayName)} (${chalk.cyan(authResult.username)})!`));
      console.log(chalk.gray('Your usage will now be tracked and added to the leaderboard.'));
      
    } else {
      throw new Error(authResult.error || 'Authentication failed');
    }
  } catch (error) {
    console.error(chalk.red('❌ Authentication failed:'), error.message);
    console.log();
    console.log(chalk.yellow('🔧 Common solutions:'));
    console.log(chalk.gray('• Check your internet connection'));
    console.log(chalk.gray('• Ensure pop-ups are enabled in your browser'));
    console.log(chalk.gray('• Try running the command again'));
    
    throw error;
  }
}