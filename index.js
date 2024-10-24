const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

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
    const articles = response.data.results.slice(0, 10); // Get the first 10 articles
    console.log(`Fetched ${articles.length} articles from CryptoPanic API`);
    return articles;
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

function extractArticleId(cryptopanicUrl) {
  // Example URL: https://cryptopanic.com/news/20086293/Cardano-Opens-13T-Bitcoin-Liquidity-with-BitcoinOS
  const regex = /\/news\/(\d+)\//;
  const match = cryptopanicUrl.match(regex);
  if (match && match[1]) {
    return match[1];
  } else {
    console.error(`Failed to extract article ID from URL: ${cryptopanicUrl}`);
    return null;
  }
}

async function scrapeArticleContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for any redirects to complete
    await page.waitForLoadState('networkidle', { timeout: 60000 });

    // Extract the content
    const content = await page.evaluate(() => {
      const selectors = ['article', '.article-body', '.post-content', 'main', '.entry-content'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element.innerText.trim();
      }
      return document.body.innerText.trim();
    });

    return content.slice(0, 1000) + (content.length > 1000 ? '...' : '');
  } catch (error) {
    console.error(`Error scraping content from ${url}:`, error.message);
    return 'Failed to extract article content';
  }
}

async function processArticles(articles) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)' +
      ' Chrome/115.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  for (const article of articles) {
    console.log('-----------------------------------');
    console.log(`Title: ${article.title}`);
    console.log(`Published at: ${article.published_at}`);
    console.log(`CryptoPanic URL: ${article.url}`);

    const articleId = extractArticleId(article.url);
    if (!articleId) {
      console.error(`Skipping article due to missing ID: ${article.title}`);
      continue;
    }

    const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;

    console.log(`External Link URL: ${externalLinkUrl}`);

    // Scrape the content from the external article
    const content = await scrapeArticleContent(page, externalLinkUrl);

    // Log or process the content as needed
    console.log(`Content excerpt: ${content}`);

    // If you want to send this data to a webhook, uncomment the code below
    /*
    try {
      await axios.post(process.env.MAKE_WEBHOOK_URL, {
        title: article.title,
        published_at: article.published_at,
        cryptopanic_url: article.url,
        content: content
      });
      console.log(`Sent article to webhook: ${article.title}`);
    } catch (error) {
      console.error(`Error sending article "${article.title}" to webhook:`, error.message);
    }
    */

    // Pause between requests to be polite
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await browser.close();
}

async function main() {
  const articles = await fetchTrendingNews();
  await processArticles(articles);
}

main()
  .then(() => console.log('Processing completed'))
  .catch(error => {
    console.error('An error occurred:', error.message);
    process.exit(1);
  });
