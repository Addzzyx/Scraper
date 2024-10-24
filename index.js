const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

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
    const articles = response.data.results.slice(0, 10);
    console.log(`Fetched ${articles.length} articles from CryptoPanic API`);
    return articles;
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

function extractArticleId(cryptopanicUrl) {
  const regex = /\/news\/(\d+)\//;
  const match = cryptopanicUrl.match(regex);
  return match?.[1] || null;
}

async function scrapeArticleContent(page, url) {
  try {
    // Navigate to URL with extended timeout
    await page.goto(url, { 
      timeout: 120000,
      waitUntil: 'domcontentloaded'
    });

    // Check for challenge/protection pages
    const isProtected = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const protectedPhrases = [
        'verify you are human',
        'access denied',
        'security check',
        'cloudflare',
        'ddos protection',
        'please wait'
      ];
      return protectedPhrases.some(phrase => bodyText.includes(phrase));
    });

    if (isProtected) {
      console.warn(`Protection detected at ${url}`);
      return '[Protected: Unable to access content]';
    }

    // Wait for content with multiple selector options
    try {
      await page.waitForSelector([
        'article',
        '[role="article"]',
        '.article-content',
        '.post-content',
        '.entry-content',
        'main',
        '#content',
        '.content'
      ].join(','), { timeout: 30000 });
    } catch (error) {
      console.log('Content selector timeout, attempting extraction anyway...');
    }

    // Extract and clean content
    const content = await page.evaluate(() => {
      // Remove unwanted elements first
      const unwanted = document.querySelectorAll([
        'script',
        'style',
        'nav',
        'header',
        'footer',
        '.ad',
        '.ads',
        '.advertisement',
        '.social-share',
        '.related-posts'
      ].join(','));
      unwanted.forEach(el => el.remove());

      // Try to find main content
      const selectors = [
        'article',
        '[role="article"]',
        '.article-content',
        '.post-content',
        '.entry-content',
        'main',
        '#content',
        '.content'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.innerText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .join('\n');
          
          if (text.length > 150) {  // Ensure meaningful content
            return text;
          }
        }
      }

      // Fallback to body content if no suitable container found
      return document.body.innerText;
    });

    // Clean and format the content
    const cleanContent = content
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return cleanContent.slice(0, 1500) + (cleanContent.length > 1500 ? '...' : '');

  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return `[Error: ${error.message}]`;
  }
}

async function processArticles(articles) {
  const browser = await chromium.launch({
    args: ['--no-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
               '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    for (const article of articles) {
      console.log('\n' + '='.repeat(50));
      console.log(`Processing: ${article.title}`);
      console.log(`Published: ${article.published_at}`);
      console.log(`URL: ${article.url}`);

      const articleId = extractArticleId(article.url);
      if (!articleId) continue;

      const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
      console.log(`Following redirect link: ${externalLinkUrl}`);

      const content = await scrapeArticleContent(page, externalLinkUrl);
      console.log('\nExtracted Content:');
      console.log('-'.repeat(50));
      console.log(content);

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    const articles = await fetchTrendingNews();
    await processArticles(articles);
    console.log('\nProcessing completed successfully');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}
