const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

// Common paywall and subscription phrases
const PAYWALL_PHRASES = [
    'subscribe to continue',
    'subscribe to read',
    'premium content',
    'subscription required',
    'sign in to read',
    'login to continue',
    'members only',
    'subscribe now',
    'premium article'
];

// Expanded list of content selectors
const CONTENT_SELECTORS = [
    // Main content selectors
    'article[class*="content"]',
    'article[class*="article"]',
    'div[class*="article-content"]',
    'div[class*="post-content"]',
    'div[class*="entry-content"]',
    '.article-body',
    '.post-body',
    '.entry-text',
    
    // Site-specific selectors
    '.cointelegraph-content',
    '.coindesk-content',
    '.decrypt-content',
    '.bitcoinist-content',
    
    // Generic content selectors
    'main article',
    '[role="article"]',
    '.story-content',
    '.news-content',
    '#article-body',
    '.article__body',
    '.content-body',
    
    // Fallback selectors
    '.main-content',
    '.content',
    'article',
    'main'
];

// Elements to remove from content
const UNWANTED_SELECTORS = [
    // Navigation elements
    'nav',
    'header',
    'footer',
    
    // Ads and promotional content
    '.ad',
    '.ads',
    '.advertisement',
    '[class*="ads-"]',
    '[class*="advertisement"]',
    '[id*="google_ads"]',
    
    // Social media and sharing
    '.social-share',
    '.share-buttons',
    '[class*="social"]',
    
    // Comments and related content
    '.comments',
    '.related-articles',
    '.recommended',
    
    // Author info and metadata
    '.author-bio',
    '.article-meta',
    '.article-tags',
    
    // Newsletter and subscription prompts
    '.newsletter',
    '.subscription',
    '.paywall',
    
    // Generic unwanted elements
    'script',
    'style',
    'iframe',
    'button',
    '[role="button"]',
    '.sidebar'
];

async function fetchTrendingNews() {
    console.log('Fetching trending news from CryptoPanic API...');
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
        console.log(`Successfully fetched ${articles.length} trending articles`);
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

async function isPaywalled(page) {
    return await page.evaluate((phrases) => {
        const pageText = document.body.innerText.toLowerCase();
        return phrases.some(phrase => pageText.includes(phrase.toLowerCase()));
    }, PAYWALL_PHRASES);
}

async function scrapeArticleContent(page, url) {
    console.log(`\nAttempting to scrape: ${url}`);
    try {
        // Navigate with appropriate settings
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Get final URL after redirects
        const finalUrl = page.url();
        console.log('Resolved URL:', finalUrl);

        // Check for paywall
        if (await isPaywalled(page)) {
            console.log('Paywall detected, skipping article');
            return null;
        }

        // Wait for content with dynamic retry
        let contentFound = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page.waitForSelector(CONTENT_SELECTORS.join(','), { 
                    timeout: 5000,
                    state: 'attached'
                });
                contentFound = true;
                break;
            } catch (e) {
                console.log(`Attempt ${attempt}: Waiting for content to load...`);
                await page.waitForTimeout(2000);
            }
        }

        if (!contentFound) {
            console.log('No content selectors found after retries');
        }

        // Extract and clean content
        const content = await page.evaluate((contentSelectors, unwantedSelectors) => {
            // Remove unwanted elements
            unwantedSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Try each content selector
            for (const selector of contentSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const text = element.innerText
                        .trim()
                        .replace(/\s+/g, ' ')
                        .replace(/\n{3,}/g, '\n\n');
                        
                    if (text.length > 200) {
                        return text;
                    }
                }
            }

            // Fallback: find largest text block
            const textBlocks = Array.from(document.body.getElementsByTagName('*'))
                .map(el => ({
                    element: el,
                    text: el.innerText.trim()
                }))
                .filter(({text}) => text.length > 200)
                .sort((a, b) => b.text.length - a.text.length);

            return textBlocks.length > 0 ? textBlocks[0].text : null;
        }, CONTENT_SELECTORS, UNWANTED_SELECTORS);

        if (!content) {
            console.log('No meaningful content found');
            return null;
        }

        // Clean up common patterns
        const cleanContent = content
            .replace(/Related Articles:?.*$/is, '')
            .replace(/Disclaimer:?.*$/is, '')
            .replace(/Follow us on.*$/is, '')
            .replace(/Share this article:?.*$/is, '')
            .replace(/Originally published at.*$/is, '')
            .trim();

        if (cleanContent.length < 200) {
            console.log('Content too short after cleaning');
            return null;
        }

        console.log(`Successfully extracted ${cleanContent.length} characters`);
        return {
            content: cleanContent,
            source_url: finalUrl
        };

    } catch (error) {
        console.error('Error during scraping:', {
            url: url,
            error: error.message,
            stack: error.stack
        });
        return null;
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
    const results = [];

    try {
        for (const article of articles) {
            console.log('\n' + '='.repeat(50));
            console.log(`Processing: ${article.title}`);

            const articleId = article.url.match(/\/news\/(\d+)\//)?.[1];
            if (!articleId) {
                console.log('Could not extract article ID, skipping');
                continue;
            }

            const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
            const content = await scrapeArticleContent(page, externalLinkUrl);

            if (content) {
                results.push({
                    title: article.title,
                    published_at: article.published_at,
                    cryptopanic_url: article.url,
                    source_url: content.source_url,
                    content: content.content
                });
                console.log('Article successfully processed');
            } else {
                console.log('Article processing failed');
            }

            // Rate limiting
            console.log('Waiting before next article...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } finally {
        await browser.close();
    }

    return results;
}

async function main() {
    console.log('Starting article scraper...');
    
    try {
        const articles = await fetchTrendingNews();
        if (articles.length === 0) {
            console.error('No articles fetched, exiting...');
            process.exit(1);
        }

        const processedArticles = await processArticles(articles);
        
        console.log('\nScraping Summary:');
        console.log(`Total articles fetched: ${articles.length}`);
        console.log(`Successfully processed: ${processedArticles.length}`);
        console.log(`Failed: ${articles.length - processedArticles.length}`);

        processedArticles.forEach((article, index) => {
            console.log(`\nArticle ${index + 1}: ${article.title}`);
            console.log(`Source: ${article.source_url}`);
            console.log(`Content Length: ${article.content.length} characters`);
            console.log('Preview:', article.content.substring(0, 200) + '...');
        });

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

main();
