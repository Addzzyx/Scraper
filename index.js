const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/v1/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p';

async function fetchTrendingNewsUrls() {
  const params = {
    auth_token: CRYPTOPANIC_API_KEY,
    filter: 'trending',
    public: 'true',
    kind: 'news',
    regions: 'en',
    timeframe: '48h'
  };

  try {
    const response = await axios.get(CRYPTOPANIC_API_URL, { params });
    return response.data.results.slice(0, 10);
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function scrapeContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Try multiple potential article selectors
    const content = await page.evaluate(() => {
      const selectors = ['article', '.article-body', '.post-content', 'main', '.entry-content'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.innerText.trim();
        }
      }
      return 'Failed to find article content';
    });

    return content.slice(0, 1000) + (content.length > 1000 ? '...' : ''); // Truncate to 1000 characters
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return 'Failed to scrape content';
  }
}

async function scrapeAndSendNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const articles = await fetchTrendingNewsUrls();

  for (const article of articles) {
    const content = await scrapeContent(page, article.url);
    const scrapedArticle = {
      title: article.title,
      url: article.url,
      source_url: article.source.url,
      source_name: article.source.title,
      published_at: article.published_at,
      content: content
    };

    try {
      await axios.post(MAKE_WEBHOOK_URL, scrapedArticle);
      console.log(`Sent to webhook: ${article.title}`);
    } catch (error) {
      console.error(`Failed to send to webhook: ${article.title}`);
    }
  }

  await browser.close();
}

scrapeAndSendNews().then(() => console.log('Scraping completed'));
