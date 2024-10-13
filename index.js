const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/v1/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p';

async function fetchTrendingNews() {
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
    return response.data.results.slice(0, 10); // Limit to top 10 trending articles
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
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
    return 'Error fetching content.';
  }
}

async function fetchAndScrapeNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const articles = await fetchTrendingNews();

  const scrapedArticles = await Promise.all(articles.map(async (article) => {
    const content = await scrapeArticleContent(page, article.url);
    return {
      title: article.title,
      url: article.url,
      published_at: article.published_at,
      sentiment: article.votes,
      source: article.source?.title,
      content: content
    };
  }));

  await browser.close();
  return scrapedArticles;
}

async function sendToWebhook(article) {
  try {
    await axios.post(MAKE_WEBHOOK_URL, article);
    console.log(`Sent article to webhook: ${article.title}`);
  } catch (error) {
    console.error(`Error sending article to webhook: ${article.title}`, error.message);
  }
}

fetchAndScrapeNews()
  .then(news => {
    return Promise.all(news.map(sendToWebhook));
  })
  .then(() => {
    console.log('All articles processed and sent to webhook.');
  })
  .catch(error => {
    console.error('Error in main process:', error.message);
  });
