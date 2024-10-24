const { chromium } = require('playwright');

async function scrapeRisingNews() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    console.log('Starting scrape...');
    
    // Add more console logs to track progress
    console.log('Navigating to CryptoPanic...');
    
    // Navigate with increased timeout
    await page.goto('https://cryptopanic.com/news?filter=rising', {
      waitUntil: 'networkidle',
      timeout: 90000 // 90 seconds
    });

    console.log('Page loaded, checking for content...');
    
    // Try multiple selectors that might indicate the page has loaded
    const selectors = [
      '.news-item',
      '.news-title',
      '.posts-listing',
      'article'
    ];

    // Wait for any of these selectors
    for (const selector of selectors) {
      try {
        console.log(`Trying to find selector: ${selector}`);
        await page.waitForSelector(selector, { 
          timeout: 45000,
          state: 'visible'
        });
        console.log(`Found selector: ${selector}`);
        break;
      } catch (err) {
        console.log(`Selector ${selector} not found, trying next...`);
      }
    }

    // Take a screenshot for debugging
    await page.screenshot({ path: 'debug-screenshot.png' });
    console.log('Took debug screenshot');

    // Get current date for comparison
    const now = new Date();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    console.log('Attempting to extract articles...');

    // Extract articles with more detailed error handling
    const articles = await page.evaluate((twoDaysAgoTime) => {
      const results = [];
      
      // Try different selectors for news items
      const items = document.querySelectorAll('.news-item, article, .post-item');
      console.log(`Found ${items.length} potential news items`);
      
      for (const item of items) {
        try {
          // Get timestamp - try multiple possible selectors
          const timeElement = item.querySelector('time') || item.querySelector('.time') || item.querySelector('.date');
          if (!timeElement) continue;
          
          const timestamp = new Date(timeElement.getAttribute('datetime') || timeElement.getAttribute('data-timestamp') || timeElement.textContent);
          
          // Check if article is within last 48 hours
          if (timestamp >= new Date(twoDaysAgoTime)) {
            const titleElement = item.querySelector('.news-title a') || item.querySelector('h2 a') || item.querySelector('.title a');
            if (!titleElement) continue;
            
            results.push({
              title: titleElement.textContent.trim(),
              url: titleElement.href,
              published_at: timestamp.toISOString()
            });
          }
        } catch (err) {
          console.log('Error processing individual item:', err);
        }
      }
      return results;
    }, twoDaysAgo.getTime());

    console.log('\nResults:');
    console.log('----------------------------------------');
    console.log(`Found ${articles.length} articles from the last 48 hours\n`);
    
    if (articles.length === 0) {
      console.log('Warning: No articles found. This might indicate a problem with the scraper.');
      
      // Get page content for debugging
      const pageContent = await page.content();
      console.log('\nPage HTML preview (first 500 chars):');
      console.log(pageContent.substring(0, 500));
    } else {
      // Print each article in an easy to read format
      articles.forEach((article, index) => {
        console.log(`Article ${index + 1}:`);
        console.log(`Title: ${article.title}`);
        console.log(`URL: ${article.url}`);
        console.log(`Published: ${new Date(article.published_at).toLocaleString()}`);
        console.log('----------------------------------------\n');
      });
    }

  } catch (error) {
    console.error('Error scraping news:', error);
    console.error('Error stack:', error.stack);
    
    // Try to get page content even if there's an error
    try {
      const pageContent = await page.content();
      console.log('\nPage HTML preview (first 500 chars):');
      console.log(pageContent.substring(0, 500));
    } catch (err) {
      console.error('Could not get page content:', err);
    }
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
