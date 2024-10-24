const { chromium } = require('playwright');
const axios = require('axios');

// Initial logging
console.log('Script initialization started');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

// Verify API key
if (!CRYPTOPANIC_API_KEY) {
    console.error('CRYPTOPANIC_API_KEY is not set in environment variables');
    process.exit(1);
}
console.log('API key verification successful');

async function fetchTrendingNews() {
    console.log('Fetching trending news from API...');
    const params = {
        auth_token: CRYPTOPANIC_API_KEY,
        filter: 'trending',
        public: 'true',
        kind: 'news',
        regions: 'en',
        timeframe: '48h'
    };

    try {
        console.log('Making API request to CryptoPanic...');
        const response = await axios.get(CRYPTOPANIC_API_URL, { params });
        
        if (!response.data || !response.data.results) {
            console.error('Invalid API response structure:', response.data);
            return [];
        }

        const articles = response.data.results.slice(0, 10);
        console.log(`Successfully fetched ${articles.length} articles`);
        return articles;
    } catch (error) {
        console.error('Error fetching from CryptoPanic API:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        return [];
    }
}

async function scrapeArticleContent(page, url) {
    console.log(`\nAttempting to scrape content from: ${url}`);
    try {
        // Navigate to URL with extended timeout
        console.log('Initiating page navigation...');
        await page.goto(url, { 
            timeout: 120000,
            waitUntil: 'domcontentloaded'
        });
        console.log('Page navigation completed');

        // Check for protection pages
        const isProtected = await page.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase();
            return ['verify you are human', 'security check', 'cloudflare'].some(
                phrase => bodyText.includes(phrase)
            );
        });

        if (isProtected) {
            console.warn('Protection/CAPTCHA detected on page');
            return '[Protected: Unable to access content]';
        }

        console.log('Attempting to extract content...');
        const content = await page.evaluate(() => {
            // Remove unwanted elements
            ['script', 'style', 'nav', 'header', 'footer', '.ad', '.share']
                .forEach(selector => {
                    document.querySelectorAll(selector)
                        .forEach(el => el.remove());
                });

            // Try to find main content
            const selectors = [
                'article',
                '[role="article"]',
                '.article-content',
                '.post-content',
                '.entry-content',
                'main',
                '#content'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const text = element.innerText
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line)
                        .join('\n');
                    
                    if (text.length > 150) return text;
                }
            }

            return document.body.innerText;
        });

        const cleanContent = content
            .replace(/\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        console.log('Content extraction successful');
        return cleanContent.slice(0, 1500) + (cleanContent.length > 1500 ? '...' : '');

    } catch (error) {
        console.error('Error during content scraping:', {
            url,
            error: error.message,
            stack: error.stack
        });
        return `[Error: ${error.message}]`;
    }
}

async function processArticles(articles) {
    console.log('\nInitializing browser for content scraping...');
    const browser = await chromium.launch({
        args: ['--no-sandbox']
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    console.log('Browser initialized successfully');

    try {
        for (const article of articles) {
            console.log('\n' + '='.repeat(50));
            console.log('Processing article:', {
                title: article.title,
                published: article.published_at
            });

            const articleId = extractArticleId(article.url);
            if (!articleId) {
                console.error('Failed to extract article ID from:', article.url);
                continue;
            }

            const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
            console.log('External link:', externalLinkUrl);

            const content = await scrapeArticleContent(page, externalLinkUrl);
            console.log('Content length:', content.length);
            console.log('\nExtracted content preview:');
            console.log(content.substring(0, 200) + '...');
        }
    } catch (error) {
        console.error('Error in article processing:', error);
    } finally {
        console.log('\nClosing browser...');
        await browser.close();
    }
}

function extractArticleId(url) {
    const regex = /\/news\/(\d+)\//;
    const match = url.match(regex);
    return match?.[1] || null;
}

// Add unhandled rejection handler
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

// Main execution
console.log('Starting main execution...');
async function main() {
    try {
        const articles = await fetchTrendingNews();
        if (articles.length === 0) {
            console.error('No articles fetched, exiting...');
            process.exit(1);
        }
        await processArticles(articles);
        console.log('\nProcessing completed successfully');
    } catch (error) {
        console.error('Fatal error in main execution:', error);
        process.exit(1);
    }
}

main();
