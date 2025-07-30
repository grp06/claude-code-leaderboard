import open from 'open';
import express from 'express';
import chalk from 'chalk';
import { apiFetch } from '../utils/api.js';
import { scanAllHistoricalUsage } from '../utils/usage-scanner.js';
import ora from 'ora';
import { getDeviceMetadata } from '../utils/device.js';

const REDIRECT_URI = 'http://localhost:7632/callback';

// Start OAuth 1.0a flow using backend endpoints
export async function startOAuth1aFlow() {
  return new Promise(async (resolve, reject) => {
    let requestToken;
    
    // Create Express app for handling callback
    const app = express();
    let server;
    
    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      if (server) {
        server.close();
      }
      reject(new Error('Authentication timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    
    // Handle callback
    app.get('/callback', async (req, res) => {
      try {
        const { oauth_token, oauth_verifier, denied } = req.query;
        
        if (denied) {
          res.send(`
            <html>
              <body>
                <h1>❌ Authentication Denied</h1>
                <p>You denied the authorization request.</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server.close();
          return reject(new Error('User denied authorization'));
        }
        
        if (!oauth_token || !oauth_verifier) {
          res.send(`
            <html>
              <body>
                <h1>❌ Authentication Failed</h1>
                <p>Invalid response from Twitter</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
          clearTimeout(timeout);
          server.close();
          return reject(new Error('Invalid OAuth response'));
        }
        
        // Verify with backend
        console.log(chalk.blue('🔐 Verifying with backend...'));
        
        // Get device metadata
        const deviceMetadata = await getDeviceMetadata();
        
        const verifyResponse = await apiFetch('/api/auth/oauth/verify', {
          method: 'POST',
          body: JSON.stringify({
            oauth_token,
            oauth_verifier,
            device: deviceMetadata
          })
        });
        
        if (!verifyResponse.ok) {
          const errorText = await verifyResponse.text();
          let errorMessage = 'Verification failed';
          
          // Parse specific error types
          if (errorText.includes('invalid_token')) {
            errorMessage = 'Invalid OAuth token. Please try authenticating again.';
          } else if (errorText.includes('expired')) {
            errorMessage = 'OAuth token expired. Please authenticate again.';
          } else if (errorText.includes('rate_limit')) {
            errorMessage = 'Rate limit exceeded. Please wait a few minutes and try again.';
          } else if (errorText.includes('already_authenticated')) {
            errorMessage = 'This device is already authenticated to a different account.';
          } else {
            errorMessage = `Verification failed: ${errorText}`;
          }
          
          throw new Error(errorMessage);
        }
        
        const authData = await verifyResponse.json();
        
        res.send(`
          <html>
            <body>
              <h1>✅ Authentication Successful!</h1>
              <p>Welcome ${authData.user.twitter_display_name} (@${authData.user.twitter_username})!</p>
              <p>You can close this window and return to the terminal.</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 2000);
              </script>
            </body>
          </html>
        `);
        
        clearTimeout(timeout);
        server.close();
        
        if (authData.magic_link) {
          console.log();
          console.log(chalk.green('✓ Authenticated as @' + authData.user.twitter_username));
          
          // Sync historical usage if this is a new user
          if (!authData.user.history_sync_completed) {
            console.log();
            console.log(chalk.blue('📊 Checking if historical sync is needed...'));
            
            try {
              // First, double-check with the backend if sync is really needed
              // This prevents expensive local scanning if user is already synced
              const checkResponse = await apiFetch(`/api/user/stats?twitter_user_id=${authData.user.twitter_user_id}`, {
                headers: {
                  'X-OAuth-Token': authData.user.oauth_token,
                  'X-OAuth-Token-Secret': authData.user.oauth_token_secret
                }
              });
              
              if (checkResponse.ok) {
                const userData = await checkResponse.json();
                // If user already has significant token usage, skip sync
                if (userData.stats && userData.stats.total_tokens > 0) {
                  console.log(chalk.yellow('✓ Historical data already synced'));
                } else {
                  // Proceed with sync only if user has no token data
                  console.log(chalk.blue('📊 No existing token data found. Scanning for historical Claude usage...'));
                  
                  const { entries, totals } = await scanAllHistoricalUsage(true);
                  
                  if (entries.length > 0) {
                    const syncSpinner = ora('Uploading historical data... Just a moment! Youll see your spot on the leaderboard soon!').start();
                    
                    // Send historical data to API
                    const deviceMetadata = await getDeviceMetadata();
                    const syncResponse = await apiFetch('/api/usage/sync-history', {
                      method: 'POST',
                      body: JSON.stringify({
                        twitter_user_id: authData.user.twitter_user_id,
                        usage_entries: entries,
                        device: deviceMetadata
                      })
                    });
                    
                    if (!syncResponse.ok) {
                      const errorText = await syncResponse.text();
                      // Check if it's a "already synced" error
                      if (errorText.includes('already synced')) {
                        syncSpinner.succeed('Historical data already synced');
                      } else {
                        syncSpinner.fail('Failed to sync historical data');
                        console.error(chalk.red('Error syncing historical data:', errorText));
                      }
                    } else {
                      const result = await syncResponse.json();
                      syncSpinner.succeed(`Synced ${chalk.cyan(entries.length.toLocaleString())} historical usage entries`);
                      if (result.rank) {
                        console.log(chalk.green(`🏆 You're ranked #${chalk.cyan(result.rank)} on the leaderboard!`));
                      }
                    }
                  } else {
                    console.log(chalk.gray('No historical usage data found'));
                  }
                }
              } else {
                // If check fails, still don't scan immediately - just log error
                console.error(chalk.red('Unable to verify sync status with server'));
                console.log(chalk.yellow('Historical sync skipped. You can run "claudecount stats" later to sync your data.'));
              }
            } catch (error) {
              console.error(chalk.red('Error during historical sync:', error.message));
              // Don't fail auth if historical sync fails
            }
          } else {
            console.log(chalk.green('✓ Historical data already synced'));
          }
          
          console.log();
          console.log(chalk.green('✓ Opening claudecount.com...'));
          console.log();
          
          // Open the magic link in browser
          open(authData.magic_link).catch((err) => {
            console.log(chalk.yellow('⚠️ Could not open browser automatically'));
            console.log(chalk.gray('Visit: ' + authData.magic_link));
          });
        }
        
        resolve({
          success: true,
          oauth_token: authData.user.oauth_token,
          oauth_token_secret: authData.user.oauth_token_secret,
          userId: authData.user.twitter_user_id,
          username: authData.user.twitter_username,
          displayName: authData.user.twitter_display_name,
          oauthVersion: '1.0a',
          magicLink: authData.magic_link
        });
        
      } catch (error) {
        res.send(`
          <html>
            <body>
              <h1>❌ Authentication Failed</h1>
              <p>Error: ${error.message}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
    
    // Start server
    server = app.listen(7632, async (err) => {
      if (err) {
        clearTimeout(timeout);
        return reject(err);
      }
      
      try {
        // Step 1: Get auth URL from backend
        console.log(chalk.blue('🔑 Getting authentication URL from server...'));
        
        const requestResponse = await apiFetch('/api/auth/oauth/request');
        
        if (!requestResponse.ok) {
          const error = await requestResponse.text();
          throw new Error(`Failed to start OAuth flow: ${error}`);
        }
        
        const { auth_url, request_token } = await requestResponse.json();
        requestToken = request_token;
        
        console.log(chalk.blue('🌐 Starting local server on port 7632...'));
        console.log(chalk.yellow('📱 Opening browser for Twitter authentication...'));
        console.log();
        console.log(chalk.gray('If your browser doesn\'t open automatically, visit:'));
        console.log(chalk.cyan(auth_url));
        console.log();
        console.log(chalk.green('✨ If you\'re already logged into Twitter,'));
        console.log(chalk.green('   you\'ll skip directly to the authorization screen!'));
        console.log();
        
        // Open the authenticate URL
        open(auth_url).catch((err) => {
          console.log(chalk.yellow('⚠️ Could not open browser automatically'));
          console.log(chalk.gray('Please visit the URL shown above'));
        });
        
        console.log();
        console.log(chalk.yellow('⏳ Waiting for authorization...'));
        
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
  });
}

// Create OAuth 1.0a signed request helper for API calls
export function createOAuth1aSigner(oauthToken, oauthTokenSecret) {
  // This is now handled by the backend
  // The CLI just needs to pass the tokens to the backend
  return {
    signRequest(url, method = 'GET', data = {}) {
      // Return empty header since backend handles OAuth signing
      return {};
    }
  };
}