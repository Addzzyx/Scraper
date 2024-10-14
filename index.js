const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

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
    return response.data.results.slice(0, 10).map(article => ({
      title: article.title,
      crypto_panic_url: article.url, // This is the CryptoPanic URL
      source_name: article.source.title,
      published_at: article.published_at
    }));
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function getExternalLink(page, cryptoPanicUrl) {
  try {
    await page.goto(cryptoPanicUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for the external link element to be loaded
    await page.waitForSelector('a.font-bold[href^="/news/click/"]', { timeout: 5000 });
    const externalPartialUrl = await page.evaluate(() => {
      const link = document.querySelector('a.font-bold[href^="/news/click/"]');
      return link ? link.getAttribute('href') : null;
    });
    if (externalPartialUrl) {
      const externalRedirectUrl = new URL(externalPartialUrl, 'https://cryptopanic.com').href;
      // Navigate to the redirect URL to get the final external URL
      await page.goto(externalRedirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const finalExternalUrl = page.url();
      return finalExternalUrl;
    } else {
      console.error(`External link not found on CryptoPanic page: ${cryptoPanicUrl}`);
      return null;
    }
  } catch (error) {
    console.error(`Error getting external link from ${cryptoPanicUrl}:`, error.message);
    return null;
  }
}

async function scrapeArticleContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('article, .article-body, .post-content, main, .entry-content', { timeout: 10000 }).catch(() => {});

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

async function retryOperation(operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function scrapeAndSendNews() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const articles = await fetchTrendingNewsUrls();

  for (const article of articles) {
    console.log(`Processing article: ${article.title}`);
    try {
      // Get the external URL from the CryptoPanic page
      const externalUrl = await retryOperation(() => getExternalLink(page, article.crypto_panic_url));

      if (!externalUrl) {
        console.error(`Failed to get external URL for article: ${article.title}`);
        continue; // Skip to the next article
      }
      console.log(`External URL: ${externalUrl}`);

      const content = await retryOperation(() => scrapeArticleContent(page, externalUrl));

      const scrapedArticle = {
        title: article.title,
        original_url: article.crypto_panic_url,
        source_url: externalUrl,
        source_name: article.source_name,
        published_at: article.published_at,
        content: content
      };

      // Send the scraped article to the Make.com webhook
      await axios.post(MAKE_WEBHOOK_URL, scrapedArticle);
      console.log(`Sent to webhook: ${article.title}`);
    } catch (error) {
      console.error(`Error processing article "${article.title}":`, error.message);
    }

    // Add a delay between processing articles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await browser.close();
}

scrapeAndSendNews()
  .then(() => console.log('Scraping completed'))
  .catch(error => {
    console.error('An error occurred during scraping:', error.message);
    process.exit(1);
  });
