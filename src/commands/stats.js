import chalk from 'chalk';
import ora from 'ora';
import { checkAuthStatus, loadConfig } from '../utils/config.js';
import { scanAllHistoricalUsage } from '../utils/usage-scanner.js';
import { apiFetch, authenticatedFetch } from '../utils/api.js';
import { getValidAccessToken } from '../auth/tokens.js';
import { getDeviceMetadata } from '../utils/device.js';
import open from 'open';

export async function statsCommand(options = {}) {
  const { resync = false, showDetails = false } = options;
  
  console.log(chalk.blue('📊 Claude Count Stats'));
  console.log(chalk.gray('━'.repeat(30)));
  
  // Check authentication
  const authStatus = await checkAuthStatus();
  
  if (!authStatus.isAuthenticated) {
    console.log(chalk.red('❌ Not authenticated'));
    console.log(chalk.yellow('Please run "claudecount auth" to authenticate first'));
    return;
  }
  
  console.log(chalk.green('✅ Authenticated as'), chalk.cyan(authStatus.twitterHandle));
  console.log();
  
  try {
    // Get tokens for API calls
    const tokens = await getValidAccessToken();
    const config = await loadConfig();
    
    // Check current stats from server
    let needsSync = false;
    let serverStats = null;
    
    const statsSpinner = ora('Fetching current stats from server...').start();
    
    try {
      const statsResponse = await authenticatedFetch(`/api/user/stats?twitter_user_id=${config.twitterUserId}`);
      
      if (statsResponse.ok) {
        const data = await statsResponse.json();
        serverStats = data.stats;
        
        if (serverStats && serverStats.total_tokens > 0) {
          statsSpinner.succeed(`Current server stats: ${chalk.cyan(serverStats.total_tokens.toLocaleString())} tokens`);
          
          if (!resync) {
            // Show current stats
            console.log();
            console.log(chalk.blue('📈 Your Stats:'));
            console.log(chalk.gray('─'.repeat(20)));
            console.log(`Total Tokens: ${chalk.cyan(serverStats.total_tokens.toLocaleString())}`);
            console.log(`Input Tokens: ${chalk.cyan(serverStats.input_tokens.toLocaleString())}`);
            console.log(`Output Tokens: ${chalk.cyan(serverStats.output_tokens.toLocaleString())}`);
            if (serverStats.cache_creation_tokens > 0) {
              console.log(`Cache Creation: ${chalk.cyan(serverStats.cache_creation_tokens.toLocaleString())}`);
            }
            if (serverStats.cache_read_tokens > 0) {
              console.log(`Cache Read: ${chalk.cyan(serverStats.cache_read_tokens.toLocaleString())}`);
            }
            
            if (data.rank) {
              console.log();
              console.log(chalk.green(`🏆 Leaderboard Rank: #${chalk.cyan(data.rank)}`));
            }
            
            console.log();
            console.log(chalk.gray('To force resync historical data, run:'));
            console.log(chalk.cyan('claudecount stats --resync'));
          } else {
            console.log(chalk.yellow('🔄 Force resync requested...'));
            needsSync = true;
          }
        } else {
          statsSpinner.warn('No token data found on server');
          needsSync = true;
        }
      } else {
        statsSpinner.fail('Failed to fetch server stats');
        needsSync = true;
      }
    } catch (error) {
      statsSpinner.fail(`Error fetching stats: ${error.message}`);
      needsSync = true;
    }
    
    // Sync historical data if needed or forced
    if (needsSync || resync) {
      console.log();
      console.log(chalk.blue('🔄 Syncing historical usage data...'));
      
      // Scan for historical usage
      const { entries, totals } = await scanAllHistoricalUsage(true);
      
      if (entries.length === 0) {
        console.log(chalk.yellow('No historical usage data found'));
        console.log(chalk.gray('Make sure you have used Claude Code before running this command'));
        return;
      }
      
      console.log(chalk.blue(`Found ${chalk.cyan(entries.length.toLocaleString())} usage entries`));
      console.log(chalk.blue(`Total tokens: ${chalk.cyan(totals.total.toLocaleString())}`));
      
      if (showDetails) {
        console.log();
        console.log(chalk.gray('Token breakdown:'));
        console.log(`  Input: ${totals.input.toLocaleString()}`);
        console.log(`  Output: ${totals.output.toLocaleString()}`);
        console.log(`  Cache Creation: ${totals.cache_creation.toLocaleString()}`);
        console.log(`  Cache Read: ${totals.cache_read.toLocaleString()}`);
      }
      
      // Sync with server
      const syncSpinner = ora('Uploading historical data to server...').start();
      
      try {
        const deviceMetadata = await getDeviceMetadata();
        const syncResponse = await apiFetch('/api/usage/sync-history', {
          method: 'POST',
          body: JSON.stringify({
            twitter_user_id: config.twitterUserId,
            usage_entries: entries,
            force_resync: resync,
            device: deviceMetadata
          }),
          headers: {
            'X-OAuth-Token': tokens.oauth_token,
            'X-OAuth-Token-Secret': tokens.oauth_token_secret,
            'X-Device-ID': deviceMetadata.device_id
          }
        });
        
        if (!syncResponse.ok) {
          const errorText = await syncResponse.text();
          
          // Handle specific error cases
          if (errorText.includes('already synced') && !resync) {
            syncSpinner.succeed('Historical data already synced');
            console.log(chalk.gray('Use --resync flag to force resync'));
          } else if (errorText.includes('rate limit')) {
            syncSpinner.fail('Rate limit exceeded. Please try again later');
          } else {
            syncSpinner.fail(`Sync failed: ${errorText}`);
            console.log();
            console.log(chalk.yellow('🔧 Troubleshooting tips:'));
            console.log(chalk.gray('• Check your internet connection'));
            console.log(chalk.gray('• Try running "claudecount auth" to re-authenticate'));
            console.log(chalk.gray('• If the problem persists, run "claudecount reset" and start fresh'));
          }
        } else {
          const result = await syncResponse.json();
          syncSpinner.succeed(`Successfully synced ${chalk.cyan(result.synced_count || entries.length)} entries`);
          
          if (result.rank) {
            console.log();
            console.log(chalk.green(`🏆 You're ranked #${chalk.cyan(result.rank)} on the leaderboard!`));
          }
          
          if (result.stats) {
            console.log();
            console.log(chalk.blue('📈 Updated Stats:'));
            console.log(chalk.gray('─'.repeat(20)));
            console.log(`Total Tokens: ${chalk.cyan(result.stats.total_tokens.toLocaleString())}`);
          }
        }
      } catch (error) {
        syncSpinner.fail(`Sync error: ${error.message}`);
        console.log();
        console.log(chalk.yellow('💡 This might be a temporary issue. Try again in a few moments.'));
      }
    }
    
    // Offer to open leaderboard
    console.log();
    console.log(chalk.gray('View the full leaderboard at:'));
    console.log(chalk.cyan('https://claudecount.com'));
    
    if (!options.skipOpen) {
      setTimeout(() => {
        open('https://claudecount.com').catch(() => {
          // Silently fail if can't open browser
        });
      }, 1000);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    
    if (error.message.includes('No tokens available')) {
      console.log(chalk.yellow('Please run "claudecount auth" to authenticate'));
    }
  }
}

// Separate sync status check command
export async function syncStatusCommand() {
  console.log(chalk.blue('🔍 Sync Status Check'));
  console.log(chalk.gray('━'.repeat(30)));
  
  const authStatus = await checkAuthStatus();
  
  if (!authStatus.isAuthenticated) {
    console.log(chalk.red('❌ Not authenticated'));
    return;
  }
  
  console.log(chalk.green('✅ Authenticated as'), chalk.cyan(authStatus.twitterHandle));
  
  try {
    const config = await loadConfig();
    const syncSpinner = ora('Checking sync status...').start();
    
    // Check with server
    const response = await authenticatedFetch(`/api/user/sync-status?twitter_user_id=${config.twitterUserId}`);
    
    if (response.ok) {
      const data = await response.json();
      syncSpinner.succeed('Sync status retrieved');
      
      console.log();
      console.log(chalk.blue('📊 Sync Information:'));
      console.log(chalk.gray('─'.repeat(20)));
      console.log(`History Synced: ${data.history_sync_completed ? chalk.green('✓') : chalk.red('✗')}`);
      if (data.last_sync_date) {
        console.log(`Last Sync: ${chalk.cyan(new Date(data.last_sync_date).toLocaleString())}`);
      }
      if (data.device_count) {
        console.log(`Devices Connected: ${chalk.cyan(data.device_count)}`);
      }
      console.log(`Total Entries: ${chalk.cyan((data.total_entries || 0).toLocaleString())}`);
      
      if (!data.history_sync_completed) {
        console.log();
        console.log(chalk.yellow('💡 Historical data not synced'));
        console.log(chalk.gray('Run "claudecount stats" to sync your usage data'));
      }
    } else {
      syncSpinner.fail('Failed to check sync status');
    }
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  }
}