const { chromium } = require('playwright');

async function scrapeRisingNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    console.log('Starting scrape...');
    
    await page.goto('https://cryptopanic.com/news?filter=rising', {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    console.log('Page loaded, waiting for news items...');
    
    // Wait for the news items to load
    await page.waitForSelector('.news-item', { timeout: 30000 });

    // Get current date for comparison
    const now = new Date();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    // Extract articles
    const articles = await page.evaluate((twoDaysAgoTime) => {
      const items = document.querySelectorAll('.news-item');
      const results = [];
      
      for (const item of items) {
        // Get timestamp
        const timeElement = item.querySelector('time');
        const timestamp = new Date(timeElement.getAttribute('datetime'));
        
        // Check if article is within last 48 hours
        if (timestamp >= new Date(twoDaysAgoTime)) {
          const titleElement = item.querySelector('.news-title a');
          
          results.push({
            title: titleElement.textContent.trim(),
            url: titleElement.href,
            published_at: timestamp.toISOString()
          });
        }
      }
      return results;
    }, twoDaysAgo.getTime());

    console.log('\nResults:');
    console.log('----------------------------------------');
    console.log(`Found ${articles.length} articles from the last 48 hours\n`);
    
    // Print each article in an easy to read format
    articles.forEach((article, index) => {
      console.log(`Article ${index + 1}:`);
      console.log(`Title: ${article.title}`);
      console.log(`URL: ${article.url}`);
      console.log(`Published: ${new Date(article.published_at).toLocaleString()}`);
      console.log('----------------------------------------\n');
    });

  } catch (error) {
    console.error('Error scraping news:', error);
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
