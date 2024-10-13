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
    return response.data.results.slice(0, 10).map(article => ({
      title: article.title,
      url: article.url,
      source: article.source.title
    }));
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function scrapeContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await page.evaluate(() => {
      const article = document.querySelector('article') || document.querySelector('.article-body') || document.body;
      return article.innerText.trim();
    });
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
      ...article,
      content: content.slice(0, 500) + '...' // Truncate content for brevity
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
