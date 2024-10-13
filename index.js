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
    console.log(`Fetched ${response.data.results.length} articles from CryptoPanic API`);
    return response.data.results.slice(0, 10);
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function scrapeContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for potential content load
    await page.waitForSelector('article, .article-body, .post-content, .entry-content', { timeout: 10000 }).catch(() => {});

    // Handle potential cookie banners or popups
    const consentButton = await page.$('.accept-cookies, .consent-button');
    if (consentButton) await consentButton.click();

    const content = await page.evaluate(() => {
      const selectors = ['article', '.article-body', '.post-content', '.entry-content', 'main'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.innerText.trim();
        }
      }
      return document.body.innerText.trim();
    });

    return content.slice(0, 1000) + (content.length > 1000 ? '...' : '');
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return 'Failed to scrape content';
  }
}

async function scrapeAndSendNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const articles = await fetchTrendingNewsUrls();

  const scrapedArticles = [];

  for (const article of articles) {
    const content = await scrapeContent(page, article.url);
    scrapedArticles.push({
      title: article.title,
      url: article.url,
      source_url: article.source.url,
      source_name: article.source.title,
      published_at: article.published_at,
      content: content
    });
    console.log(`Scraped article: ${article.title}`);
  }

  await browser.close();

  try {
    await axios.post(MAKE_WEBHOOK_URL, { articles: scrapedArticles });
    console.log(`Sent ${scrapedArticles.length} articles to webhook`);
  } catch (error) {
    console.error('Failed to send articles to webhook:', error.message);
  }
}

// Run the main function
scrapeAndSendNews().then(() => console.log('Scraping completed')).catch(console.error);
