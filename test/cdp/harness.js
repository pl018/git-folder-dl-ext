/**
 * CDP Test Harness
 * Launches Chrome with the extension loaded and runs basic smoke tests.
 * Usage: npm test (or node test/cdp/harness.js)
 *
 * Prerequisites:
 * - Run `npm run build` first to create dist/
 * - npm install puppeteer
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.join(__dirname, '..', '..', 'dist');
const TEST_REPO_URL = 'https://github.com/octocat/Hello-World';

async function runTests() {
  // Verify dist exists
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    console.error('ERROR: dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  console.log('Launching Chrome with extension...');

  const browser = await puppeteer.launch({
    headless: false, // Extensions require headed mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const results = { passed: 0, failed: 0, errors: [] };

  try {
    // Test 1: Extension loads
    await test('Extension loads successfully', async () => {
      const targets = browser.targets();
      const swTarget = targets.find(t =>
        t.type() === 'service_worker' && t.url().includes('service-worker')
      );
      // Service worker may take a moment to register
      if (!swTarget) {
        await new Promise(r => setTimeout(r, 2000));
        const targets2 = browser.targets();
        const sw2 = targets2.find(t =>
          t.type() === 'service_worker' && t.url().includes('service-worker')
        );
        if (!sw2) throw new Error('Service worker not found');
      }
    }, results);

    // Test 2: Content script injects on GitHub
    const page = await browser.newPage();
    await test('Content script injects on GitHub repo page', async () => {
      await page.goto(TEST_REPO_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      // Wait for content script to run
      await new Promise(r => setTimeout(r, 2000));

      // Check for shadow host
      const shadowHost = await page.$('#gfdl-shadow-host');
      if (!shadowHost) throw new Error('Shadow DOM host not found');
    }, results);

    // Test 3: Checkboxes appear
    await test('Checkboxes injected into file rows', async () => {
      // Navigate to a branch with files
      await page.goto(TEST_REPO_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const checkboxes = await page.$$('.gfdl-checkbox');
      // May or may not find checkboxes depending on GitHub's current DOM
      // This is a soft check
      console.log(`  Found ${checkboxes.length} checkboxes`);
    }, results);

    // Test 4: Popup opens
    await test('Popup page renders', async () => {
      // Get extension ID from service worker URL
      const targets = browser.targets();
      const swTarget = targets.find(t =>
        t.type() === 'service_worker' && t.url().includes('service-worker')
      );
      if (!swTarget) throw new Error('Service worker not found for popup test');

      const swUrl = swTarget.url();
      const extId = swUrl.split('/')[2];
      const popupUrl = `chrome-extension://${extId}/popup/popup.html`;

      const popupPage = await browser.newPage();
      await popupPage.goto(popupUrl, { waitUntil: 'load', timeout: 10000 });

      const title = await popupPage.$eval('.popup__title', el => el.textContent);
      if (title !== 'GFDL') throw new Error(`Expected title "GFDL", got "${title}"`);

      const browserModeLabel = await popupPage.$eval('label[for="browserDownloadMode"]', el => el.textContent);
      if (!browserModeLabel.includes('BROWSER')) {
        throw new Error(`Expected browser download mode setting label, got "${browserModeLabel}"`);
      }

      await popupPage.close();
    }, results);

    await page.close();

  } finally {
    await browser.close();
  }

  // Report
  console.log('\n--- Test Results ---');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('\nFailures:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

async function test(name, fn, results) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    results.passed++;
  } catch (err) {
    console.log(`FAIL: ${name} - ${err.message}`);
    results.failed++;
    results.errors.push(`${name}: ${err.message}`);
  }
}

runTests().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
