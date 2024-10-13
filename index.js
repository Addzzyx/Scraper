const axios = require('axios');
const { chromium } = require('playwright');

const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/v1/posts/';
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p';

async function fetchTrendingNews() {
  try {
    const response = await axios.get(CRYPTOPANIC_API_URL, {
      params: {
        auth_token: CRYPTOPANIC_API_KEY,
        public: 'true',
        sort: 'trending',
        limit: 10
      }
    });
    return response.data.results;
  } catch (error) {
    console.error('Error fetching from CryptoPanic API:', error.message);
    return [];
  }
}

async function scrapeArticleContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const content = await page.evaluate(() => {
      const articleBody = document.querySelector('article') || document.querySelector('.article-body') || document.querySelector('main');
      return articleBody ? articleBody.innerText : 'Could not extract content';
    });

    return content;
  } catch (error) {
    console.error(`Error scraping content from ${url}:`, error.message);
    return 'Error: Could not scrape content';
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    const trendingNews = await fetchTrendingNews();
    
    for (const article of trendingNews) {
      const fullContent = await scrapeArticleContent(page, article.url);
      
      const articleData = {
        title: article.title,
        url: article.url,
        published_at: article.published_at,
        source: article.source.title,
        content: fullContent
      };

      // Send data to Make.com webhook
      await axios.post(MAKE_WEBHOOK_URL, articleData);
      console.log(`Sent article to webhook: ${articleData.title}`);
    }
  } catch (error) {
    console.error('Error in main process:', error.message);
  } finally {
    await browser.close();
  }
}

main();
