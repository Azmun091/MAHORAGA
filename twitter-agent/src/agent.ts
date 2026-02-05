import { BrowserController, SnapshotElement } from './browser-controller.js';
import { LLMVision } from './llm-vision.js';

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author: string;
  author_followers: number;
  retweets: number;
  likes: number;
}

export interface BreakingNewsItem {
  symbol: string;
  headline: string;
  author: string;
  age_minutes: number;
  is_breaking: boolean;
}

export class TwitterAutonomousAgent {
  private browser: BrowserController;
  private llm: LLMVision;
  private initialized: boolean = false;
  private screenshotPaths: string[] = []; // Track screenshot paths for cleanup

  constructor(
    chromeDebugPort: number,
    openaiApiKey: string,
    llmModel: string = 'gpt-4o-mini'
  ) {
    this.browser = new BrowserController(chromeDebugPort);
    this.llm = new LLMVision(openaiApiKey, llmModel);
  }

  /**
   * Initialize the agent - verify Chrome connection and Twitter authentication
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check Chrome connection
    const connected = await this.browser.isConnected();
    if (!connected) {
      throw new Error(
        `Chrome is not running with remote debugging on port ${this.browser['chromeWsEndpoint']}. ` +
        'Please start Chrome with: chrome.exe --remote-debugging-port=9222 --user-data-dir="<profile>"'
      );
    }

    // Try to find existing Twitter tab first
    try {
      const tabs = await this.browser.listTabs();
      const twitterTab = tabs.find(tab => 
        tab.url.includes('twitter.com') || tab.url.includes('x.com')
      );
      
      if (twitterTab) {
        console.log(`[TwitterAgent] Found existing Twitter tab: ${twitterTab.url}`);
        await this.browser.switchTab(twitterTab.id);
        await this.delay(2000);
        
        // Check if we're already on home page
        const currentUrl = await this.browser.getCurrentUrl();
        if (!currentUrl.includes('/home')) {
          await this.browser.open('https://twitter.com/home');
          await this.delay(3000);
        }
      } else {
        // No Twitter tab found, open new one
        await this.browser.open('https://twitter.com/home');
        await this.delay(5000); // Give more time for initial load
      }
    } catch (error) {
      // If tab listing fails, just try to open
      console.warn('[TwitterAgent] Could not list tabs, opening directly:', error);
      await this.browser.open('https://twitter.com/home');
      await this.delay(5000);
    }

    // Take screenshot and verify authentication
    const screenshotResult = await this.browser.screenshot();
    if (screenshotResult.path) this.screenshotPaths.push(screenshotResult.path);
    const screenshot = screenshotResult.base64;
    const authCheck = await this.llm.checkAuthentication(screenshot);

    if (!authCheck.success || !authCheck.data?.authenticated) {
      // Log the LLM response for debugging
      console.warn('[TwitterAgent] Auth check result:', JSON.stringify(authCheck, null, 2));
      console.warn('[TwitterAgent] Warning: Could not verify authentication via LLM. Continuing anyway - will verify on first search.');
      // Don't throw error - allow initialization to continue
      // Authentication will be verified when first search is attempted
    } else {
      console.log('[TwitterAgent] Authentication verified via LLM');
    }

    this.initialized = true;
    console.log('[TwitterAgent] Initialized successfully');
  }

  /**
   * Search for tweets on Twitter
   */
  async searchTwitter(query: string, maxResults: number = 10): Promise<Tweet[]> {
    if (!this.initialized) {
      await this.init();
    }

    try {
      console.log(`[TwitterAgent] Starting search for: ${query} (max: ${maxResults})`);
      
      // Navigate to Twitter search - use simpler URL without extra params
      const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(query)}`;
      console.log(`[TwitterAgent] Navigating to: ${searchUrl}`);
      await this.browser.open(searchUrl);
      await this.delay(5000); // Give more time for initial load

      // Set viewport to be taller to see more tweets in one screenshot
      // Estimate: ~200px per tweet, so for maxResults we need at least maxResults * 200px
      const viewportHeight = Math.max(5000, maxResults * 300); // At least 5000px or more based on maxResults
      console.log(`[TwitterAgent] Setting viewport height to ${viewportHeight}px to see more tweets`);
      await this.browser.setViewportHeight(viewportHeight);
      await this.delay(2000);

      // Take screenshot and verify results loaded
      console.log('[TwitterAgent] Taking initial screenshot...');
      let screenshotResult = await this.browser.screenshot();
      if (screenshotResult.path) this.screenshotPaths.push(screenshotResult.path);
      let screenshot = screenshotResult.base64;
      let verifyAttempts = 0;
      const maxVerifyAttempts = 8;

      while (verifyAttempts < maxVerifyAttempts) {
        const verify = await this.llm.verifySearchResults(screenshot);
        console.log(`[TwitterAgent] Verify attempt ${verifyAttempts + 1}:`, verify.success ? 'Results loaded' : 'Waiting...');
        
        if (verify.success && verify.data?.results_loaded) {
          console.log('[TwitterAgent] Search results confirmed loaded');
          break;
        }

        if (verifyAttempts < maxVerifyAttempts - 1) {
          await this.delay(3000); // Wait longer between attempts
          screenshotResult = await this.browser.screenshot();
          if (screenshotResult.path) this.screenshotPaths.push(screenshotResult.path);
          screenshot = screenshotResult.base64;
        }
        verifyAttempts++;
      }

      // Scroll multiple times to load more tweets
      // Twitter typically shows 3-5 tweets per screen, so we need multiple scrolls
      console.log('[TwitterAgent] Scrolling to load more tweets...');
      // Calculate scrolls: aim for at least 2-3x the maxResults to ensure we have enough loaded
      const scrollCount = Math.max(5, Math.ceil(maxResults / 2)); // More aggressive scrolling
      console.log(`[TwitterAgent] Will perform ${scrollCount} scrolls to load up to ${maxResults} tweets`);
      
      // Do all scrolls first to load content
      for (let i = 0; i < scrollCount; i++) {
        await this.browser.scroll('down', 2500); // Scroll more pixels for better loading
        await this.delay(3500); // Wait longer for new tweets to load (Twitter can be slow)
        console.log(`[TwitterAgent] Scroll ${i + 1}/${scrollCount} completed`);
      }
      
      // Scroll back to top to start capturing from beginning
      console.log('[TwitterAgent] Scrolling to top to start extraction...');
      // Scroll up multiple times to ensure we're at the very top
      // Use larger scroll amounts and more iterations
      for (let i = 0; i < 10; i++) {
        await this.browser.scroll('up', 5000);
        await this.delay(800);
      }
      await this.delay(3000); // Give extra time for page to settle
      
      // Verify we can see tweets before starting extraction
      console.log('[TwitterAgent] Verifying tweets are visible before extraction...');
      let verifyScreenshotResult = await this.browser.screenshot();
      if (verifyScreenshotResult.path) this.screenshotPaths.push(verifyScreenshotResult.path);
      let verifyScreenshot = verifyScreenshotResult.base64;
      const verifyCheck = await this.llm.verifySearchResults(verifyScreenshot);
      if (!verifyCheck.success || !verifyCheck.data?.results_loaded) {
        console.warn('[TwitterAgent] Tweets may not be loaded, waiting a bit more...');
        await this.delay(5000);
        verifyScreenshotResult = await this.browser.screenshot();
        if (verifyScreenshotResult.path) this.screenshotPaths.push(verifyScreenshotResult.path);
        verifyScreenshot = verifyScreenshotResult.base64;
        const secondCheck = await this.llm.verifySearchResults(verifyScreenshot);
        if (!secondCheck.success || !secondCheck.data?.results_loaded) {
          console.error('[TwitterAgent] Could not verify tweets are loaded, proceeding anyway...');
        }
      }

      // Extract tweets iteratively until we have exactly maxResults
      console.log(`[TwitterAgent] Extracting tweets until we have exactly ${maxResults}...`);
      const allTweets: any[] = [];
      const seen = new Set<string>();
      let scrollPosition = 0;
      const maxScrollAttempts = 50; // Increased max attempts to ensure we get enough
      let scrollAttempts = 0;
      let consecutiveEmptyScreenshots = 0;
      const maxConsecutiveEmpty = 5; // Increased tolerance before aggressive scroll
      let lastTweetCount = 0;
      let stuckCount = 0;

      while (allTweets.length < maxResults && scrollAttempts < maxScrollAttempts) {
        let foundNewTweets = false;
        
        try {
          // Take screenshot at current position
          const screenshotResult = await this.browser.screenshot();
          if (screenshotResult.path) this.screenshotPaths.push(screenshotResult.path);
          screenshot = screenshotResult.base64;
          
          // Request more tweets than needed to ensure we capture all visible ones
          const extraction = await this.llm.extractTweetsFromScreenshot(screenshot, maxResults * 3);
          
          // DEBUG: Log what the LLM actually returned
          console.log(`[TwitterAgent] Position ${scrollAttempts + 1} - LLM Response:`, JSON.stringify({
            success: extraction.success,
            hasData: !!extraction.data,
            tweetsCount: extraction.data?.tweets?.length || 0,
            totalFound: extraction.data?.total_found || 0,
            error: extraction.error,
            firstTweetText: extraction.data?.tweets?.[0]?.text?.substring(0, 50) || 'none'
          }, null, 2));
          
          if (extraction.success && extraction.data?.tweets && extraction.data.tweets.length > 0) {
            // Add new unique tweets
            const beforeCount = allTweets.length;
            for (const tweet of extraction.data.tweets) {
              // Use a more robust deduplication key (first 150 chars)
              const key = (tweet.text || '').substring(0, 150).toLowerCase().trim();
              if (key && key.length > 10 && !seen.has(key)) { // Only add if text is substantial
                seen.add(key);
                allTweets.push(tweet);
                
                if (allTweets.length >= maxResults) {
                  console.log(`[TwitterAgent] ✅ Reached target of ${maxResults} tweets!`);
                  break;
                }
              } else {
                // DEBUG: Log why tweet was skipped
                if (key.length <= 10) {
                  console.log(`[TwitterAgent] Skipped tweet: text too short (${key.length} chars)`);
                } else if (seen.has(key)) {
                  console.log(`[TwitterAgent] Skipped tweet: duplicate (key: ${key.substring(0, 50)}...)`);
                }
              }
            }
            
            const newTweets = allTweets.length - beforeCount;
            foundNewTweets = newTweets > 0;
            console.log(`[TwitterAgent] Position ${scrollAttempts + 1}: LLM found ${extraction.data.tweets.length} tweets, ${newTweets} were new, total unique: ${allTweets.length}/${maxResults}`);
            
            if (foundNewTweets) {
              consecutiveEmptyScreenshots = 0; // Reset counter
              stuckCount = 0;
            } else {
              consecutiveEmptyScreenshots++;
              // Check if we're stuck (same count for multiple attempts)
              if (allTweets.length === lastTweetCount) {
                stuckCount++;
              } else {
                stuckCount = 0;
              }
            }
            lastTweetCount = allTweets.length;
          } else {
            consecutiveEmptyScreenshots++;
            console.log(`[TwitterAgent] Position ${scrollAttempts + 1}: No tweets found in screenshot`);
            if (allTweets.length === lastTweetCount) {
              stuckCount++;
            }
          }
        } catch (screenshotError) {
          console.warn(`[TwitterAgent] Screenshot failed at position ${scrollAttempts + 1}:`, String(screenshotError));
          consecutiveEmptyScreenshots++;
          stuckCount++;
          // Continue anyway - scroll and try next position
        }

        // If we're stuck or have too many consecutive empty screenshots, try different strategies
        if (stuckCount >= 3 || consecutiveEmptyScreenshots >= maxConsecutiveEmpty) {
          console.log(`[TwitterAgent] Stuck at ${allTweets.length} tweets, trying aggressive scroll...`);
          // Try scrolling more aggressively
          await this.browser.scroll('down', 5000);
          await this.delay(4000); // Wait longer for content to load
          consecutiveEmptyScreenshots = 0;
          stuckCount = 0;
        }

        // If we still need more tweets, scroll down
        if (allTweets.length < maxResults) {
          // Use larger, consistent scroll amounts to ensure we move through content
          // Twitter's infinite scroll loads content in chunks, so we need substantial scrolls
          const scrollAmount = 3000; // Fixed larger amount for more reliable scrolling
          console.log(`[TwitterAgent] Scrolling down ${scrollAmount}px to load more content...`);
          await this.browser.scroll('down', scrollAmount);
          await this.delay(4000); // Wait longer for new content to load and render
          scrollPosition += scrollAmount;
          scrollAttempts++;
        } else {
          break; // We have enough tweets
        }
      }
      
      // If we still don't have enough, try scrolling back and re-scanning
      if (allTweets.length < maxResults && scrollAttempts < maxScrollAttempts) {
        console.log(`[TwitterAgent] Only found ${allTweets.length}/${maxResults} tweets, trying re-scan from different positions...`);
        // Scroll back up a bit and try again
        await this.browser.scroll('up', 3000);
        await this.delay(2000);
        
        for (let retry = 0; retry < 3 && allTweets.length < maxResults; retry++) {
          const retryScreenshotResult = await this.browser.screenshot();
          if (retryScreenshotResult.path) this.screenshotPaths.push(retryScreenshotResult.path);
          const retryScreenshot = retryScreenshotResult.base64;
          const retryExtraction = await this.llm.extractTweetsFromScreenshot(retryScreenshot, maxResults * 2);
          
          if (retryExtraction.success && retryExtraction.data?.tweets) {
            for (const tweet of retryExtraction.data.tweets) {
              const key = (tweet.text || '').substring(0, 150).toLowerCase().trim();
              if (key && key.length > 10 && !seen.has(key)) {
                seen.add(key);
                allTweets.push(tweet);
                if (allTweets.length >= maxResults) break;
              }
            }
            console.log(`[TwitterAgent] Retry ${retry + 1}: Now have ${allTweets.length}/${maxResults} tweets`);
          }
          
          if (allTweets.length < maxResults) {
            await this.browser.scroll('down', 2000);
            await this.delay(2500);
          }
        }
      }

      const uniqueTweets = allTweets.slice(0, maxResults);
      console.log(`[TwitterAgent] Total unique tweets found: ${uniqueTweets.length}/${maxResults}`);
      
      // Clean up all screenshot files at the end (after all LLM processing is done)
      await this.cleanupScreenshots();
      
      // If we still don't have enough, try one final extraction
      if (uniqueTweets.length === 0) {
        console.log('[TwitterAgent] No tweets found, trying final extraction...');
        const finalScreenshotResult = await this.browser.screenshot();
        if (finalScreenshotResult.path) this.screenshotPaths.push(finalScreenshotResult.path);
        const finalScreenshot = finalScreenshotResult.base64;
        const finalExtraction = await this.llm.extractTweetsFromScreenshot(finalScreenshot, maxResults);
        
        if (finalExtraction.success && finalExtraction.data?.tweets && finalExtraction.data.tweets.length > 0) {
          console.log(`[TwitterAgent] Final extraction found ${finalExtraction.data.tweets.length} tweets`);
          // Use final extraction results
          const tweets: Tweet[] = finalExtraction.data.tweets
            .slice(0, maxResults)
            .map((tweet: any, index: number) => ({
              id: `browser_${Date.now()}_${index}`,
              text: tweet.text || '',
              created_at: tweet.created_at || new Date().toISOString(),
              author: tweet.author?.replace('@', '') || 'unknown',
              author_followers: 0,
              retweets: tweet.retweets || 0,
              likes: tweet.likes || 0,
            }));
          
          // Clean up screenshots at the end
          await this.cleanupScreenshots();
          
          console.log(`[TwitterAgent] Successfully extracted ${tweets.length} tweets from final extraction`);
          await this.delay(1000 + Math.random() * 2000);
          return tweets;
        }
        
        // If final extraction also fails, try fallback
        console.warn('[TwitterAgent] All extraction methods failed, trying fallback method');
        const fallbackTweets = await this.extractTweetsFallback(maxResults);
        
        // Clean up screenshots at the end
        await this.cleanupScreenshots();
        
        if (fallbackTweets.length > 0) {
          return fallbackTweets;
        }
        console.error('[TwitterAgent] All extraction methods failed');
        return [];
      }

      // Transform unique tweets to expected format
      const tweets: Tweet[] = uniqueTweets
        .slice(0, maxResults)
        .map((tweet: any, index: number) => ({
          id: `browser_${Date.now()}_${index}`,
          text: tweet.text || '',
          created_at: tweet.created_at || new Date().toISOString(),
          author: tweet.author?.replace('@', '') || 'unknown',
          author_followers: 0, // Not available from screenshot
          retweets: tweet.retweets || 0,
          likes: tweet.likes || 0,
        }));

      console.log(`[TwitterAgent] Successfully extracted ${tweets.length} unique tweets (target was ${maxResults})`);

      // Clean up all screenshots at the end (after all LLM processing is done)
      await this.cleanupScreenshots();

      // Simulate human behavior
      await this.delay(1000 + Math.random() * 2000);

      return tweets;
    } catch (error) {
      console.error('[TwitterAgent] Search error:', error);
      // Clean up screenshots even on error
      await this.cleanupScreenshots().catch(() => {});
      
      // Fallback to deterministic extraction
      try {
        return await this.extractTweetsFallback(maxResults);
      } catch (fallbackError) {
        console.error('[TwitterAgent] Fallback extraction also failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Clean up all screenshot files created during this search
   */
  private async cleanupScreenshots(): Promise<void> {
    const { unlink } = await import('fs/promises');
    
    for (const path of this.screenshotPaths) {
      if (path) {
        try {
          await unlink(path);
          console.log(`[TwitterAgent] Cleaned up screenshot: ${path}`);
        } catch (error) {
          // Ignore errors if file doesn't exist
        }
      }
    }
    
    // Clear the array
    this.screenshotPaths = [];
    
    // Also do a general cleanup of any remaining screenshots
    await this.browser.cleanupScreenshots();
  }

  /**
   * Fallback method: extract tweets using deterministic selectors
   */
  private async extractTweetsFallback(maxResults: number): Promise<Tweet[]> {
    try {
      const snapshot = await this.browser.snapshot();
      const tweets: Tweet[] = [];

      // Look for tweet elements in snapshot
      const tweetElements = snapshot.elements.filter(
        el => el.tag === 'article' || el.attributes?.testid === 'tweet'
      );

      for (let i = 0; i < Math.min(tweetElements.length, maxResults); i++) {
        const el = tweetElements[i];
        tweets.push({
          id: `fallback_${Date.now()}_${i}`,
          text: el.text || '',
          created_at: new Date().toISOString(),
          author: 'unknown',
          author_followers: 0,
          retweets: 0,
          likes: 0,
        });
      }

      return tweets;
    } catch {
      return [];
    }
  }

  /**
   * Check for breaking news for given symbols
   */
  async checkBreakingNews(symbols: string[]): Promise<BreakingNewsItem[]> {
    if (symbols.length === 0) {
      return [];
    }

    const toCheck = symbols.slice(0, 3);
    const queries = toCheck.map(s => `$${s}`).join(' OR ');
    const newsQuery = `(${queries}) (from:FirstSquawk OR from:DeItaone OR from:Newsquawk) -is:retweet`;

    const tweets = await this.searchTwitter(newsQuery, 5);

    const results: BreakingNewsItem[] = [];
    const MAX_NEWS_AGE_MS = 1800_000; // 30 minutes
    const BREAKING_THRESHOLD_MS = 600_000; // 10 minutes

    for (const tweet of tweets) {
      const tweetAge = Date.now() - new Date(tweet.created_at).getTime();
      if (tweetAge > MAX_NEWS_AGE_MS) continue;

      const mentionedSymbol = toCheck.find(
        s => tweet.text.toUpperCase().includes(`$${s}`) || 
             tweet.text.toUpperCase().includes(` ${s} `)
      );

      if (mentionedSymbol) {
        // Check if from news accounts
        const isNewsAccount = 
          tweet.author.toLowerCase().includes('firstsquawk') ||
          tweet.author.toLowerCase().includes('deitaone') ||
          tweet.author.toLowerCase().includes('newsquawk');

        if (isNewsAccount) {
          results.push({
            symbol: mentionedSymbol,
            headline: tweet.text.slice(0, 200),
            author: tweet.author,
            age_minutes: Math.round(tweetAge / 60000),
            is_breaking: tweetAge < BREAKING_THRESHOLD_MS,
          });
        }
      }
    }

    return results;
  }

  /**
   * Health check - verify agent is ready
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const connected = await this.browser.isConnected();
      if (!connected) {
        return {
          healthy: false,
          message: 'Chrome not connected',
        };
      }

      if (!this.initialized) {
        await this.init();
      }

      return {
        healthy: true,
        message: 'Agent is ready',
      };
    } catch (error) {
      return {
        healthy: false,
        message: String(error),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
