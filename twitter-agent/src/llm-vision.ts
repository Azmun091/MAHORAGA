import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface VisionAnalysisResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class LLMVision {
  private openai: ReturnType<typeof createOpenAI>;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.openai = createOpenAI({ apiKey });
    // Remove 'openai/' prefix if present - createOpenAI expects just model name
    this.model = model.replace(/^openai\//, '');
  }

  /**
   * Analyze a screenshot with a custom prompt
   */
  async analyzeScreenshot(
    imageBase64: string,
    prompt: string,
    responseFormat?: 'json_object' | 'text'
  ): Promise<VisionAnalysisResult> {
    try {
      const result = await generateText({
        model: this.openai(this.model),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image',
                image: `data:image/png;base64,${imageBase64}`,
              },
            ],
          },
        ],
        temperature: 0.3,
        maxOutputTokens: 2000,
        ...(responseFormat === 'json_object' && { responseFormat: { type: 'json_object' } }),
      });

      if (responseFormat === 'json_object') {
        try {
          const parsed = JSON.parse(result.text);
          return { success: true, data: parsed };
        } catch {
          return { success: false, error: 'Failed to parse JSON response' };
        }
      }

      return { success: true, data: result.text };
    } catch (error) {
      return {
        success: false,
        error: `LLM vision error: ${String(error)}`,
      };
    }
  }

  /**
   * Find an element in the page by description
   */
  async findElementInPage(
    screenshot: string,
    description: string
  ): Promise<VisionAnalysisResult> {
    const prompt = `Analyze this screenshot of a Twitter page. Find the element described: "${description}".

Respond with JSON in this exact format:
{
  "found": true/false,
  "element_ref": "@e1" or null,
  "element_description": "description of what you found",
  "action_needed": "click" | "type" | "scroll" | null,
  "selector_hint": "CSS selector or testid if visible"
}`;

    return this.analyzeScreenshot(screenshot, prompt, 'json_object');
  }

  /**
   * Extract tweets from a screenshot
   */
  async extractTweetsFromScreenshot(
    screenshot: string,
    maxResults: number = 10
  ): Promise<VisionAnalysisResult> {
    const prompt = `You are analyzing a screenshot of Twitter/X search results. Your task is to extract ALL visible tweets from the screenshot.

CRITICAL INSTRUCTIONS:
1. Look for tweet cards/containers - these are usually rectangular boxes containing:
   - A profile picture/avatar at the top left
   - A username/handle (usually @username format) near the profile picture
   - The tweet text content (main body of the tweet)
   - Engagement metrics (like count, retweet count, reply count) - usually numbers with icons
   - A timestamp (e.g., "2h", "1d", "Jan 15", "10h ago")

2. Each tweet is typically separated visually from others - look for distinct containers or cards. Tweets are arranged vertically in a feed.

3. Extract the following for EACH visible tweet:
   - "text": The complete tweet text content (all the words in the tweet, even if it's long)
   - "author": The username/handle (with or without @, e.g., "username" or "@username")
   - "created_at": Timestamp if visible (e.g., "2024-02-04T10:00:00Z" or "2h ago" or approximate ISO format)
   - "likes": Number of likes if visible (extract the number, default to 0 if not visible)
   - "retweets": Number of retweets if visible (extract the number, default to 0 if not visible)

4. Extract as many tweets as you can see, up to ${maxResults} tweets. If you see MORE than ${maxResults} tweets, extract the first ${maxResults} ones starting from the top.

5. If you see NO tweets (only search bar, navigation, or empty results), return an empty array.

6. Be EXTREMELY thorough - examine the ENTIRE visible area from top to bottom and extract ALL visible tweets. Don't miss any tweets that are partially visible. Look carefully - tweets might be close together or have different styling.

7. CRITICAL: Each tweet card is a separate tweet. Look for distinct tweet containers/cards. Extract every single one you can see, even if they're partially off-screen. Count them carefully - if you see 5 tweet cards, extract all 5, not just 2 or 3.

8. Tweets may appear in different styles or layouts - look for any content that appears to be a tweet/post, regardless of exact formatting.

9. IMPORTANT: If you see multiple tweets on screen, extract ALL of them. Don't stop after extracting just 1 or 2 tweets if there are more visible. Be systematic: start from the top of the visible area and work your way down, extracting each tweet you encounter.

10. Double-check your count: Before responding, count how many distinct tweet cards/containers you can see in the screenshot. Make sure your "tweets" array contains that many entries (up to ${maxResults}).

Respond with JSON in this EXACT format (no markdown, no code blocks, just pure JSON):
{
  "tweets": [
    {
      "text": "The complete tweet text here",
      "author": "username",
      "created_at": "2024-02-04T10:00:00Z",
      "likes": 123,
      "retweets": 45
    }
  ],
  "total_found": 5
}

If no tweets are visible, return: {"tweets": [], "total_found": 0}`;

    return this.analyzeScreenshot(screenshot, prompt, 'json_object');
  }

  /**
   * Check if user is authenticated on Twitter
   */
  async checkAuthentication(screenshot: string): Promise<VisionAnalysisResult> {
    const prompt = `Analyze this screenshot of Twitter/X. Determine if the user is logged in/authenticated.

STRONG INDICATORS OF AUTHENTICATION (if you see these, user IS authenticated):
- Visible tweet feed with actual tweets (not login page)
- Left sidebar with navigation icons (home, search, profile, messages, etc.)
- Profile picture/avatar visible in the sidebar (usually at bottom left)
- "Post" or "Postear" button visible (means user can post)
- "What's happening" or "Qué está pasando" section in right sidebar
- Tweet engagement buttons (like, retweet, comment) visible
- User can see their timeline with multiple tweets

INDICATORS OF NOT AUTHENTICATED:
- "Sign in" or "Iniciar sesión" button prominently displayed
- Login form with username/password fields
- "Create account" or "Crear cuenta" prompts
- No tweets visible, only login prompts

IMPORTANT: If you see a feed with tweets, sidebar navigation, and profile elements, the user IS authenticated even if you don't see explicit "logged in" text.

Respond with JSON:
{
  "authenticated": true/false,
  "confidence": 0.0-1.0,
  "indicators": ["specific visual elements you see that indicate authentication status"]
}`;

    return this.analyzeScreenshot(screenshot, prompt, 'json_object');
  }

  /**
   * Find the search box on Twitter
   */
  async findSearchBox(screenshot: string): Promise<VisionAnalysisResult> {
    const prompt = `Analyze this screenshot of Twitter. Find the search box or search input field.

Respond with JSON:
{
  "found": true/false,
  "element_ref": "@e1" or null,
  "location": "top_bar" | "sidebar" | "center" | null,
  "action": "click" | "type" | null,
  "description": "description of the search element"
}`;

    return this.analyzeScreenshot(screenshot, prompt, 'json_object');
  }

  /**
   * Verify that search results have loaded
   */
  async verifySearchResults(screenshot: string): Promise<VisionAnalysisResult> {
    const prompt = `Analyze this screenshot of Twitter/X. Determine if search results have loaded and tweets are visible.

STRONG INDICATORS THAT RESULTS ARE LOADED:
- Multiple tweet cards/containers visible on screen
- Each tweet card has: profile picture, username, tweet text, engagement buttons
- The search query appears in the URL bar or search box
- A list/feed of tweets is visible (not just empty space or loading spinner)
- You can see actual tweet content (not just "No results" or error messages)

INDICATORS THAT RESULTS ARE NOT LOADED:
- Only search bar visible
- Loading spinner or "Loading..." text
- Empty white space where tweets should be
- Error message like "Something went wrong"
- "No results found" message (this still counts as "loaded" but with 0 results)

Respond with JSON:
{
  "results_loaded": true/false,
  "confidence": 0.0-1.0,
  "tweet_count_visible": number of tweet cards you can see (0 if none)
}`;

    return this.analyzeScreenshot(screenshot, prompt, 'json_object');
  }
}
