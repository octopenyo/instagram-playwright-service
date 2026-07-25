const { chromium } = require('playwright');
const { logger } = require('./utils/logger');
const SessionManager = require('./sessionManager');
const fs = require('fs').promises;

class InstagramService {
  constructor() {
    this.sessionManager = new SessionManager();
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isManualLogin = process.env.AUTO_LOGIN === 'false';
    this.loginTimeout = parseInt(process.env.LOGIN_TIMEOUT) || 120000;
  }

  async initializeBrowser() {
    if (!this.browser) {
      const headless = process.env.HEADLESS === 'true';
      
      // BRAVE BROWSER PATHS - Try multiple locations
      const bravePaths = [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Users\\User\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
      ];
      
      let bravePath = null;
      for (const path of bravePaths) {
        try {
          await fs.access(path);
          bravePath = path;
          logger.info(`✅ Found Brave at: ${path}`);
          break;
        } catch (e) {
          // Path doesn't exist, try next
        }
      }
      
      if (bravePath) {
        logger.info('🦁 Using Brave Browser');
        this.browser = await chromium.launch({
          headless: headless,
          executablePath: bravePath,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            '--start-maximized',
            '--disable-brave-update'
          ]
        });
      } else {
        // Fallback to Chromium if Brave not found
        logger.warn('⚠️ Brave not found, falling back to Chromium');
        this.browser = await chromium.launch({
          headless: headless,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            '--start-maximized'
          ]
        });
      }
    }
    return this.browser;
  }

  async manualLogin() {
    try {
      logger.info('🔄 Starting manual login process...');
      logger.info('🌐 Opening browser for manual login...');
      
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
      });

      this.page = await this.context.newPage();
      
      await this.page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
      
      logger.info('==================================================');
      logger.info('🔐 MANUAL LOGIN REQUIRED');
      logger.info('==================================================');
      logger.info('📱 Please login to Instagram in the browser window');
      logger.info('⏰ You have 2 minutes to complete the login');
      logger.info('✅ After login, the service will save your session');
      logger.info('==================================================');
      
      await this.waitForManualLogin();
      
      const sessionData = await this.context.storageState();
      const username = process.env.INSTAGRAM_USERNAME || 'instagram_user';
      await this.sessionManager.saveSession(username, sessionData);
      
      logger.info('✅ Manual login successful! Session saved.');
      return true;
      
    } catch (error) {
      logger.error(`Manual login failed: ${error.message}`);
      throw new Error(`Manual login failed: ${error.message}`);
    }
  }

  async waitForManualLogin() {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Manual login timeout - please try again'));
      }, this.loginTimeout);

      try {
        await this.page.waitForSelector('a[href="/direct/inbox/"]', { 
          timeout: this.loginTimeout 
        });
        
        await this.page.waitForSelector('svg[aria-label="Home"]', { 
          timeout: 5000 
        });
        
        clearTimeout(timeout);
        resolve(true);
        
      } catch (error) {
        clearTimeout(timeout);
        reject(new Error('Login not detected - please ensure you logged in successfully'));
      }
    });
  }

  async ensureLoggedIn(sessionId) {
    if (this.isManualLogin) {
      const username = process.env.INSTAGRAM_USERNAME || 'instagram_user';
      const latestSession = await this.sessionManager.getLatestSession(username);
      
      if (latestSession) {
        logger.info('📂 Found existing session, attempting to restore...');
        const sessionData = await this.sessionManager.loadSession(latestSession);
        
        if (sessionData) {
          try {
            this.context = await this.browser.newContext({
              storageState: sessionData,
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
              viewport: { width: 1280, height: 800 }
            });
            this.page = await this.context.newPage();
            
            await this.page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
            const isValid = await this.page.evaluate(() => {
              return !document.querySelector('input[name="username"]');
            });
            
            if (isValid) {
              logger.info('✅ Session restored successfully!');
              return true;
            } else {
              logger.warn('⚠️ Session expired, requiring manual login...');
              await this.context.close();
            }
          } catch (error) {
            logger.warn(`Session restoration failed: ${error.message}`);
          }
        }
      }
      
      logger.info('🔐 No valid session found, requiring manual login...');
      return await this.manualLogin();
    }
    
    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;
    
    if (!username || !password) {
      throw new Error('Instagram credentials not found in environment variables');
    }
    
    return await this.automaticLogin(username, password);
  }

  async automaticLogin(username, password) {
    try {
      logger.info('🔄 Starting automatic login...');
      
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
      });

      this.page = await this.context.newPage();
      
      await this.page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
      
      await this.page.waitForSelector('input[name="username"]', { timeout: 10000 });
      
      await this.page.fill('input[name="username"]', username);
      await this.page.fill('input[name="password"]', password);
      
      await this.page.click('button[type="submit"]');
      
      await this.page.waitForNavigation({ waitUntil: 'networkidle' });
      
      try {
        await this.page.click('button:has-text("Not Now")', { timeout: 3000 });
      } catch (e) {}
      
      try {
        await this.page.click('button:has-text("Not Now")', { timeout: 3000 });
      } catch (e) {}

      const sessionData = await this.context.storageState();
      await this.sessionManager.saveSession(username, sessionData);
      
      logger.info(`✅ Successfully logged in as ${username}`);
      return true;
      
    } catch (error) {
      logger.error(`Automatic login failed: ${error.message}`);
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  async sendDirectMessage(username, message, sessionId = null) {
    let retries = 0;
    const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    
    while (retries < maxRetries) {
      try {
        await this.initializeBrowser();
        
        const isLoggedIn = await this.ensureLoggedIn(sessionId);
        if (!isLoggedIn) {
          throw new Error('Failed to authenticate');
        }

        await this.page.goto(`https://www.instagram.com/${username}/`, { 
          waitUntil: 'networkidle',
          timeout: 30000
        });

        const profileExists = await this.page.evaluate(() => {
          const errorElement = document.querySelector('h2:has-text("Sorry, this page isn\'t available.")');
          return !errorElement;
        });

        if (!profileExists) {
          throw new Error('Profile not found');
        }

        const messageButtonExists = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.some(button => button.textContent.trim() === 'Message');
        });

        if (!messageButtonExists) {
          throw new Error('Message button not found - user may not accept DMs');
        }

        await this.page.click('button:has-text("Message")');
        await this.page.waitForTimeout(1000);

        await this.page.waitForSelector('textarea[placeholder*="Message"]', { timeout: 10000 });
        
        await this.page.fill('textarea[placeholder*="Message"]', message);
        
        await this.page.click('button:has-text("Send")');
        
        await this.page.waitForTimeout(2000);

        const messageSent = await this.page.evaluate(() => {
          const elements = document.querySelectorAll('div[role="presentation"]');
          return elements.length > 0;
        });

        if (!messageSent) {
          throw new Error('Message may not have been sent successfully');
        }

        return {
          success: true,
          data: {
            username: username,
            messageSent: true,
            timestamp: new Date().toISOString()
          }
        };

      } catch (error) {
        logger.error(`Attempt ${retries + 1} failed: ${error.message}`);
        retries++;
        
        if (retries < maxRetries) {
          const delay = parseInt(process.env.RETRY_DELAY) || 5000;
          await this.wait(delay);
          await this.cleanup();
        } else {
          return {
            success: false,
            error: error.message
          };
        }
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded'
    };
  }

  async checkProfile(username) {
    try {
      await this.initializeBrowser();
      await this.ensureLoggedIn();

      await this.page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'networkidle'
      });

      const profileData = await this.page.evaluate(() => {
        const profileName = document.querySelector('h2')?.textContent || '';
        const bio = document.querySelector('span.-vDIg')?.textContent || '';
        const posts = document.querySelector('span.g47SY')?.textContent || '0';
        
        return {
          username: profileName,
          bio: bio,
          posts: posts,
          exists: true
        };
      });

      return {
        success: true,
        data: profileData
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getConversations(limit = 10) {
    try {
      await this.initializeBrowser();
      await this.ensureLoggedIn();

      await this.page.goto('https://www.instagram.com/direct/inbox/', {
        waitUntil: 'networkidle'
      });

      const conversations = await this.page.evaluate((limit) => {
        const threads = [];
        const items = document.querySelectorAll('div[role="button"]');
        
        for (let i = 0; i < Math.min(items.length, limit); i++) {
          const item = items[i];
          const name = item.querySelector('span')?.textContent || '';
          const preview = item.querySelector('span[dir="auto"]')?.textContent || '';
          
          threads.push({
            name: name,
            preview: preview,
            time: 'Recent'
          });
        }
        
        return threads;
      }, limit);

      return {
        success: true,
        data: conversations
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async cleanup() {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      logger.error(`Cleanup error: ${error.message}`);
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = InstagramService;