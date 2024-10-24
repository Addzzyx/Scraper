const { chromium } = require('playwright');

async function scrapeRisingNews() {
  // Launch browser with headless mode
  const browser = await chromium.launch({
    headless: true
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    console.log('Starting scrape...');
    
    // Navigate to the page and wait for network to be idle
    await page.goto('https://cryptopanic.com/news/?filter=rising', {
      waitUntil: 'networkidle'
    });

    // Wait for the Vue app to load and render content
    await page.waitForLoadState('domcontentloaded');
    
    // Add a longer wait to ensure dynamic content loads
    await page.waitForTimeout(5000);

    console.log('Page loaded, extracting articles...');

    // Extract articles using JavaScript in the page context
    const articles = await page.evaluate(() => {
      const posts = document.querySelectorAll('div[data-title]');
      return Array.from(posts).map(post => ({
        title: post.getAttribute('data-title'),
        url: post.querySelector('a')?.href || '',
        source: post.querySelector('.news-source')?.textContent?.trim() || 'Unknown'
      })).filter(article => article.title && article.url);
    });

    console.log('\nResults:');
    console.log('----------------------------------------');
    console.log(`Found ${articles.length} articles\n`);
    
    if (articles.length === 0) {
      console.log('No articles found. Taking debug screenshot...');
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
      
      // Log the page HTML for debugging
      const html = await page.content();
      console.log('\nPage HTML preview:');
      console.log(html.substring(0, 1000));
    } else {
      // Print found articles
      articles.forEach((article, index) => {
        console.log(`Article ${index + 1}:`);
        console.log(`Title: ${article.title}`);
        console.log(`URL: ${article.url}`);
        console.log(`Source: ${article.source}`);
        console.log('----------------------------------------\n');
      });
    }

  } catch (error) {
    console.error('Error scraping news:', error);
    // Take screenshot on error
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

scrapeRisingNews()
  .then(() => console.log('Scraping completed'))
  .catch(error => {
    console.error('An error occurred during scraping:', error);
    process.exit(1);
  });
