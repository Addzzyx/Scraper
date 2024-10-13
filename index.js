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

async function getRedirectUrl(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  return page.url();
}

async function scrapeArticleContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  
  const content = await page.evaluate(() => {
    const selectors = [
      '.article__content',
      'article',
      '.article-body',
      '.post-content',
      'main'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.innerText.trim();
      }
    }
    
    return 'Failed to find article content';
  });

  return content;
}

async function scrapeAndSendNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const articles = await fetchTrendingNewsUrls();

  for (const article of articles) {
    const redirectUrl = await getRedirectUrl(page, article.url);
    console.log(`Original URL: ${article.url}`);
    console.log(`Redirected URL: ${redirectUrl}`);
    
    const content = await scrapeArticleContent(page, redirectUrl);
    const scrapedArticle = {
      title: article.title,
      original_url: article.url,
      source_url: redirectUrl,
      source_name: article.source.title,
      published_at: article.published_at,
      content: content.slice(0, 1000) // Truncate to 1000 characters
    };

    try {
      await axios.post(MAKE_WEBHOOK_URL, scrapedArticle);
      console.log(`Sent to webhook: ${article.title}`);
    } catch (error) {
      console.error(`Failed to send to webhook: ${article.title}`, error.message);
    }
  }

  await browser.close();
}

scrapeAndSendNews().then(() => console.log('Scraping completed')).catch(console.error);
