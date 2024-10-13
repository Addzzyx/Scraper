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

async function scrapeArticleContent(page, url, title, summary) {
  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 // Increase timeout to 60 seconds
    });

    const content = await page.evaluate(() => {
      const articleBody = document.querySelector('article') || document.querySelector('.article-body') || document.querySelector('main');
      return articleBody ? articleBody.innerText : null;
    });

    if (content) {
      return content;
    } else {
      console.log(`Couldn't extract content for: ${title}. Using summary instead.`);
      return summary || 'No content available.';
    }
  } catch (error) {
    console.error(`Error scraping content from ${url}:`, error.message);
    return summary || 'Error fetching content.';
  }
}

async function fetchAndScrapeNews() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const articles = await fetchTrendingNews();

  const scrapedArticles = await Promise.all(articles.map(async (article) => {
    const content = await scrapeArticleContent(page, article.url, article.title, article.currencies[0]?.title);
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
