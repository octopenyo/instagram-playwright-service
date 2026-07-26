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

  async findBravePath() {
    // Common Brave install locations on Windows. Returns null if not found,
    // so callers can fall back to Playwright's bundled Chromium.
    const bravePaths = [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      `${process.env.LOCALAPPDATA || ''}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`
    ];

    for (const p of bravePaths) {
      try {
        await fs.access(p);
        return p;
      } catch (e) {
        // not found at this path, try next
      }
    }
    return null;
  }

  async initializeBrowser() {
    if (!this.browser) {
      const headless = process.env.HEADLESS === 'true';
      const bravePath = await this.findBravePath();

      const launchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--start-maximized'
      ];

      if (bravePath) {
        logger.info(`🦁 Launching Brave: ${bravePath}`);
        this.browser = await chromium.launch({
          headless: headless,
          executablePath: bravePath,
          args: launchArgs
        });
      } else {
        logger.warn('⚠️ Brave not found on this machine, falling back to bundled Chromium');
        this.browser = await chromium.launch({
          headless: headless,
          args: launchArgs
        });
      }
    }
    return this.browser;
  }

  // Dismiss Instagram's cookie-consent dialog if it appears.
  // Fresh contexts (which is what we always have on a server) show this
  // before the login form is interactable, and it silently blocks
  // waitForSelector('input[name="username"]') until it's handled.
  async dismissCookieBanner() {
    const cookieButtonTexts = [
      'Allow essential and optional cookies',
      'Allow all cookies',
      'Accept All',
      'Accept'
    ];

    for (const text of cookieButtonTexts) {
      try {
        await this.page.click(`button:has-text("${text}")`, { timeout: 3000 });
        logger.info(`🍪 Dismissed cookie banner ("${text}")`);
        return true;
      } catch (e) {
        // not present, try next
      }
    }
    return false;
  }

  // Debug helper: logs the current URL and a snippet of page text so we
  // can tell from Render logs whether we landed on the real login page,
  // a cookie wall, or an Instagram checkpoint/captcha page.
  async logPageState(label) {
    try {
      const url = this.page.url();
      const bodyText = await this.page.evaluate(() =>
        document.body ? document.body.innerText.slice(0, 300).replace(/\s+/g, ' ') : ''
      );
      logger.info(`🔎 [${label}] URL: ${url}`);
      logger.info(`🔎 [${label}] Page preview: ${bodyText}`);
    } catch (e) {
      logger.warn(`Could not capture page state for ${label}: ${e.message}`);
    }
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

      // networkidle can hang on Instagram since it keeps background
      // connections open. domcontentloaded + explicit waits is more reliable.
      await this.page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

      await this.dismissCookieBanner();
      await this.logPageState('manualLogin-initial-load');

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
            if (this.context) {
              await this.context.close().catch(() => {});
            }
            this.context = await this.browser.newContext({
              storageState: sessionData,
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
              viewport: { width: 1280, height: 800 }
            });
            this.page = await this.context.newPage();

            await this.page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
            await this.dismissCookieBanner();
            await this.logPageState('ensureLoggedIn-session-restore');

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

      // domcontentloaded instead of networkidle — Instagram keeps background
      // connections alive indefinitely, so networkidle can burn the whole
      // timeout before the form is even checked.
      await this.page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

      await this.dismissCookieBanner();
      await this.logPageState('automaticLogin-initial-load');

      await this.page.waitForSelector('input[name="username"]', { timeout: 30000 });

      await this.page.fill('input[name="username"]', username);
      await this.page.fill('input[name="password"]', password);

      await this.page.click('button[type="submit"]');

      await this.page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await this.logPageState('automaticLogin-after-submit');

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
      await this.logPageState('automaticLogin-failure');
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
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        // Instagram is a client-rendered SPA — domcontentloaded fires on the
        // raw HTML shell, before React has actually painted the profile
        // (username, buttons, everything). Checking for content immediately
        // after domcontentloaded finds an empty page every time. Wait for
        // real rendering to finish before inspecting anything.
        await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await this.page.waitForSelector('header, main, button', { timeout: 20000 }).catch(() => {});
        await this.page.waitForTimeout(1500); // brief settle for late-hydrating buttons

        const profileExists = await this.page.evaluate(() => {
          // Note: ':has-text()' is Playwright-only syntax and is NOT valid
          // real browser CSS — using it inside document.querySelector()
          // throws a SyntaxError and crashes this whole evaluate() call.
          // Match on plain textContent instead.
          const headings = Array.from(document.querySelectorAll('h2'));
          const hasErrorHeading = headings.some(h =>
            h.textContent.includes("Sorry, this page isn't available")
          );
          return !hasErrorHeading;
        });

        await this.logPageState('sendDirectMessage-after-profile-load');

        if (!profileExists) {
          throw new Error('Profile not found');
        }

        // Instagram's "Message" control is frequently a styled
        // <div role="button">, not a real <button> element — raw
        // document.querySelectorAll('button') misses it entirely even
        // when it's clearly visible on screen. getByRole matches on the
        // accessibility tree, so it finds it regardless of the actual tag.
        const messageButton = this.page.getByRole('button', { name: 'Message', exact: true });
        const messageButtonCount = await messageButton.count();

        if (messageButtonCount === 0) {
          await this.logPageState('sendDirectMessage-no-message-button-found');
          throw new Error('Message button not found - user may not accept DMs');
        }

        await messageButton.first().click();
        await this.page.waitForTimeout(1500);
        await this.logPageState('sendDirectMessage-after-message-click');

        // Instagram's DM compose box has changed over time — it's no longer
        // reliably a <textarea>. Try several known patterns in order and use
        // whichever one actually exists on the page right now, instead of
        // hardcoding one selector that silently times out when IG changes.
        const composeSelectors = [
          'textarea[placeholder*="Message"]',
          'div[contenteditable="true"][aria-label*="Message"]',
          'div[contenteditable="true"][aria-describedby*="placeholder"]',
          'div[role="textbox"][contenteditable="true"]'
        ];

        let composeBox = null;
        let matchedSelector = null;
        for (const sel of composeSelectors) {
          const locator = this.page.locator(sel).first();
          const count = await locator.count();
          if (count > 0) {
            composeBox = locator;
            matchedSelector = sel;
            break;
          }
        }

        if (!composeBox) {
          await this.logPageState('sendDirectMessage-no-compose-box-found');
          throw new Error(
            'Could not find the message compose box with any known selector. ' +
            'Instagram may have changed its DOM again — check the logged page preview.'
          );
        }

        logger.info(`✍️ Using compose box selector: ${matchedSelector}`);

        if (matchedSelector.startsWith('textarea')) {
          await composeBox.fill(message);
        } else {
          // contenteditable divs don't support .fill() reliably — click to
          // focus, then type character by character like a real user.
          await composeBox.click();
          await this.page.keyboard.type(message, { delay: 20 });
        }

        // Same issue as the Message button — Send is likely also a
        // role="button" div, not a real <button>. Use the same robust
        // approach instead of a tag-specific selector.
        const sendButton = this.page.getByRole('button', { name: 'Send', exact: true });
        const sendButtonCount = await sendButton.count();

        if (sendButtonCount === 0) {
          await this.logPageState('sendDirectMessage-no-send-button-found');
          throw new Error('Send button not found after composing message.');
        }

        await sendButton.first().click();
        await this.logPageState('sendDirectMessage-after-send-click');

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
        waitUntil: 'domcontentloaded'
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
        waitUntil: 'domcontentloaded'
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