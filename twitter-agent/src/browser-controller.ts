import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execAsync = promisify(exec);

export interface SnapshotElement {
  ref: string;
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
}

export interface SnapshotResult {
  elements: SnapshotElement[];
  screenshot?: string;
}

export class BrowserController {
  private chromeWsEndpoint: string;
  private timeout: number;
  private screenshotTimeout: number;

  constructor(chromeDebugPort: number = 9222, timeout: number = 30000) {
    this.chromeWsEndpoint = `http://localhost:${chromeDebugPort}`;
    this.timeout = timeout;
    this.screenshotTimeout = 20000; // Longer timeout for screenshots
  }


  /**
   * Execute agent-browser command
   */
  private async executeCommand(command: string, args: string[] = []): Promise<string> {
    // Use --cdp flag to connect to existing Chrome instance
    // --cdp accepts port number (e.g., 9222) for local connections
    const port = this.chromeWsEndpoint.split(':')[2];
    
    // Build command array for better Windows compatibility
    const commandParts = ['agent-browser', '--cdp', port, command, ...args];
    const fullCommand = commandParts.join(' ');
    
    try {
      const execOptions: any = {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        encoding: 'utf8' as const, // Ensure string output
      };
      
      // Use shell on Windows for proper command execution
      if (process.platform === 'win32') {
        execOptions.shell = 'cmd.exe';
      }
      
      const { stdout, stderr } = await execAsync(fullCommand, execOptions);

      if (stderr && !stderr.includes('warning') && !stderr.includes('info')) {
        throw new Error(`agent-browser error: ${stderr}`);
      }

      return String(stdout).trim();
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Command timed out after ${this.timeout}ms`);
      }
      throw new Error(`Failed to execute agent-browser: ${String(error)}`);
    }
  }

  /**
   * Navigate to a URL
   */
  async open(url: string): Promise<void> {
    // Escape URL properly for Windows shell - use single quotes or escape ampersands
    // Replace & with ^& for Windows cmd, or use proper escaping
    const escapedUrl = url.replace(/&/g, '^&');
    await this.executeCommand('open', [escapedUrl]);
    // Wait for page to load
    await this.delay(2000);
  }

  /**
   * Take a snapshot of the page with interactive elements
   */
  async snapshot(): Promise<SnapshotResult> {
    const output = await this.executeCommand('snapshot', ['-i', '--json']);
    
    try {
      const result = JSON.parse(output) as SnapshotResult;
      return result;
    } catch {
      // If JSON parsing fails, try to extract elements from text output
      const elements: SnapshotElement[] = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        const match = line.match(/@(\w+)\s+(\w+)(?:\s+(.+))?/);
        if (match) {
          elements.push({
            ref: `@${match[1]}`,
            tag: match[2],
            text: match[3]?.trim(),
          });
        }
      }
      
      return { elements };
    }
  }

  /**
   * Click an element by reference
   */
  async click(ref: string): Promise<void> {
    await this.executeCommand('click', [ref]);
    await this.delay(500);
  }

  /**
   * Fill an input field
   */
  async fill(ref: string, text: string): Promise<void> {
    // Escape text for shell - wrap in quotes
    const escapedText = text.replace(/"/g, '\\"');
    await this.executeCommand('fill', [ref, `"${escapedText}"`]);
    await this.delay(300);
  }

  /**
   * Take a screenshot with longer timeout
   * Returns both base64 data and the file path for later cleanup
   */
  async screenshot(outputPath?: string): Promise<{ base64: string; path: string }> {
    const path = outputPath || `twitter-screenshot-${Date.now()}.png`;
    const port = this.chromeWsEndpoint.split(':')[2];
    const commandParts = ['agent-browser', '--cdp', port, 'screenshot', path];
    const fullCommand = commandParts.join(' ');
    
    try {
      const execOptions: any = {
        timeout: this.screenshotTimeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8' as const,
      };
      
      if (process.platform === 'win32') {
        execOptions.shell = 'cmd.exe';
      }
      
      await execAsync(fullCommand, execOptions);
      
      // Read and return as base64, but keep the file for now
      try {
        const imageBuffer = readFileSync(path);
        const base64 = imageBuffer.toString('base64');
        // Don't delete immediately - return path for later cleanup
        return { base64, path };
      } catch {
        // If file doesn't exist, try to get screenshot data from stdout
        const output = await this.executeCommand('screenshot', ['--base64']);
        if (output) {
          return { base64: output.replace(/^data:image\/\w+;base64,/, ''), path: '' };
        }
        throw new Error(`Failed to read screenshot from ${path}`);
      }
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Screenshot timed out after ${this.screenshotTimeout}ms`);
      }
      throw new Error(`Failed to take screenshot: ${String(error)}`);
    }
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(selector: string, timeout: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const snapshot = await this.snapshot();
      const found = snapshot.elements.some(el => 
        el.attributes?.testid === selector || 
        el.text?.includes(selector)
      );
      
      if (found) {
        return;
      }
      
      await this.delay(1000);
    }
    
    throw new Error(`Element ${selector} not found within ${timeout}ms`);
  }

  /**
   * Scroll the page
   * agent-browser scroll command: scroll [direction] [pixels]
   * Using the native scroll command directly since evaluate doesn't exist
   */
  async scroll(direction: 'up' | 'down' = 'down', pixels: number = 500): Promise<void> {
    // Use agent-browser's native scroll command directly
    // Format: scroll <direction> <pixels>
    console.log(`[BrowserController] Executing scroll: ${direction} ${pixels}px`);
    try {
      const result = await this.executeCommand('scroll', [direction, pixels.toString()]);
      console.log(`[BrowserController] Scroll command executed, result: ${result.substring(0, 100)}`);
      await this.delay(2000); // Wait for scroll to complete and content to load
    } catch (error) {
      console.error(`[BrowserController] Scroll command failed:`, error);
      throw error;
    }
  }

  /**
   * Set viewport size and ensure proper zoom level (100%) for consistent screenshots
   * Note: agent-browser doesn't have evaluate command, so we can't set viewport directly
   * The viewport will be determined by content and browser window size
   */
  async setViewportHeight(height: number): Promise<void> {
    // agent-browser doesn't support evaluate command, so we can't manipulate viewport directly
    // The viewport height will be determined by the browser window and content
    console.log(`[BrowserController] Note: Viewport height requested: ${height}px (actual height depends on browser window and content)`);
    await this.delay(500);
  }

  /**
   * Clean up screenshot files
   */
  async cleanupScreenshots(): Promise<void> {
    const { readdir, unlink } = await import('fs/promises');
    const { join } = await import('path');
    
    try {
      const files = await readdir(process.cwd());
      const screenshotFiles = files.filter(f => f.startsWith('twitter-screenshot-') && f.endsWith('.png'));
      
      for (const file of screenshotFiles) {
        try {
          await unlink(join(process.cwd(), file));
          console.log(`[BrowserController] Cleaned up screenshot: ${file}`);
        } catch (error) {
          console.warn(`[BrowserController] Could not delete screenshot ${file}:`, error);
        }
      }
    } catch (error) {
      console.warn('[BrowserController] Could not cleanup screenshots:', error);
    }
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    const output = await this.executeCommand('get', ['url']);
    return output.trim();
  }

  /**
   * List all tabs
   */
  async listTabs(): Promise<Array<{ id: number; url: string; title: string }>> {
    const output = await this.executeCommand('tab');
    // Parse tab list output (format may vary)
    const tabs: Array<{ id: number; url: string; title: string }> = [];
    const lines = output.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('http')) {
        const match = line.match(/(\d+):\s*(.+?)\s+(https?:\/\/.+)/);
        if (match) {
          tabs.push({
            id: parseInt(match[1]),
            title: match[2],
            url: match[3],
          });
        }
      }
    }
    
    return tabs;
  }

  /**
   * Switch to a specific tab
   */
  async switchTab(tabId: number): Promise<void> {
    await this.executeCommand('tab', [tabId.toString()]);
    await this.delay(1000);
  }

  /**
   * Check if Chrome is connected
   */
  async isConnected(): Promise<boolean> {
    try {
      const port = this.chromeWsEndpoint.split(':')[2];
      const response = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }


  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
