const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

const MIN_CONTENT_LENGTH = 500;
const MIN_WORD_COUNT = 50;

// Unwanted content selectors
const UNWANTED_ELEMENTS = [
    'script', 'style', 'link', 'meta', 'noscript',
    'nav', 'header', 'footer', 'aside', 'iframe',
    '.ad', '.ads', '[class*="ad-"]', '[id*="ad-"]',
    '.social', '.share', '.newsletter', '.subscription',
    '.related', '.sidebar', '.menu', '.nav',
    '[class*="menu"]', '[class*="navigation"]',
    '.author', '.bio', '.profile', '.about',
    '.comments', '.toolbar', '.tools'
];

// Security check phrases
const SECURITY_PHRASES = [
    'verify you are human',
    'security check',
    'captcha',
    'access denied',
    'cloudflare',
    'ddos protection',
    'please complete the security check'
];

// Startup check
if (!CRYPTOPANIC_API_KEY) {
    console.error('Error: CRYPTOPANIC_API_KEY environment variable is not set');
    process.exit(1);
}

async function fetchTrendingNews() {
    console.log('\nStarting API fetch...');
    
    try {
        const response = await axios.get(CRYPTOPANIC_API_URL, {
            params: {
                auth_token: CRYPTOPANIC_API_KEY,
                filter: 'trending',
                public: 'true',
                kind: 'news',
                regions: 'en',
                timeframe: '48h'
            }
        });

        if (!response.data?.results) {
            console.error('Invalid API response:', response.data);
            return [];
        }

        const articles = response.data.results.slice(0, 10);
        console.log(`Successfully fetched ${articles.length} articles`);
        return articles;
    } catch (error) {
        console.error('API Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        return [];
    }
}

function cleanText(text) {
    if (!text) return '';

    return text
        // Remove HTML tags
        .replace(/<[^>]+>/g, '')
        // Remove special formatting
        .replace(/\{[^}]+\}/g, '')
        // Clean whitespace
        .replace(/\s+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        // Remove common junk text
        .replace(/^(AD|Advertisement|RSS|Share|Home|News)(\s|$)/gim, '')
        .replace(/(Go back to|Back to) .*/gi, '')
        .replace(/Related Articles:.*$/is, '')
        .replace(/Share (this )?article:.*$/is, '')
        .replace(/Follow us on.*$/im, '')
        .replace(/Read more:.*$/im, '')
        .replace(/(Tags:|Categories:).*$/im, '')
        .replace(/Newsletter.*$/im, '')
        .replace(/Subscribe.*$/im, '')
        .replace(/Originally published.*$/im, '')
        .trim();
}

async function scrapeArticleContent(page, url) {
    console.log(`\nScraping: ${url}`);
    try {
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        const finalUrl = page.url();
        console.log('Redirected to:', finalUrl);

        // Wait for content with retries
        let contentFound = false;
        for (let i = 0; i < 3; i++) {
            await page.waitForTimeout(2000);
            try {
                contentFound = await page.evaluate(() => {
                    return document.querySelector('article, .article-content, .post-content, main') !== null;
                });
                if (contentFound) break;
            } catch (e) {
                console.log(`Attempt ${i + 1}: Content check failed`);
            }
            console.log(`Content check attempt ${i + 1}...`);
        }

        // Check for security measures
        const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
        if (SECURITY_PHRASES.some(phrase => pageText.includes(phrase))) {
            console.log('Security check detected, skipping');
            return null;
        }

        // Extract content
        const result = await page.evaluate(({unwantedElements, minLength}) => {
            // Remove unwanted elements
            unwantedElements.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Try main content selectors
            const selectors = [
                'article .content',
                '.article-content',
                '.post-content',
                '.entry-content',
                'article',
                'main article',
                '[role="article"]',
                '.story-content'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    return element.innerText;
                }
            }

            // Fallback: find largest text block
            return Array.from(document.getElementsByTagName('*'))
                .map(el => ({
                    text: el.innerText,
                    area: el.offsetWidth * el.offsetHeight
                }))
                .filter(({text}) => text.length > minLength)
                .sort((a, b) => b.area - a.area)
                [0]?.text || null;

        }, {unwantedElements: UNWANTED_ELEMENTS, minLength: MIN_CONTENT_LENGTH});

        if (!result) {
            console.log('No substantial content found');
            return null;
        }

        const cleanContent = cleanText(result);
        if (cleanContent.length < MIN_CONTENT_LENGTH) {
            console.log('Content too short after cleaning');
            return null;
        }

        // Calculate real word count
        const wordCount = cleanContent
            .replace(/[^a-zA-Z\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 0)
            .length;

        if (wordCount < MIN_WORD_COUNT) {
            console.log(`Word count too low: ${wordCount}`);
            return null;
        }

        console.log(`Extracted ${cleanContent.length} characters, ${wordCount} words`);
        return {
            content: cleanContent,
            source_url: finalUrl,
            word_count: wordCount
        };

    } catch (error) {
        console.error('Scraping error:', error.message);
        return null;
    }
}

async function processArticles(articles) {
    console.log('\nInitializing browser...');
    const browser = await chromium.launch({
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    const results = [];

    try {
        for (const article of articles) {
            console.log('\n' + '='.repeat(50));
            console.log('Processing:', article.title);

            const articleId = article.url.match(/\/news\/(\d+)\//)?.[1];
            if (!articleId) {
                console.log('Could not extract article ID');
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
                    content: content.content,
                    word_count: content.word_count
                });
                console.log('Successfully processed article');
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } finally {
        await browser.close();
    }

    return results;
}

async function main() {
    console.log('Starting script...');
    
    try {
        const articles = await fetchTrendingNews();
        if (articles.length === 0) {
            throw new Error('No articles fetched from API');
        }

        const results = await processArticles(articles);
        
        console.log('\nProcessing Summary:');
        console.log(`Total articles processed: ${results.length}`);
        
        results.forEach((article, index) => {
            console.log(`\n[${index + 1}] ${article.title}`);
            console.log(`Source: ${article.source_url}`);
            console.log(`Content Length: ${article.content.length} chars`);
            console.log(`Word Count: ${article.word_count} words`);
            console.log('Preview:', article.content.substring(0, 150) + '...');
        });

        // Send to Make.com if configured
        if (MAKE_WEBHOOK_URL && results.length > 0) {
            console.log('\nSending to Make.com...');
            try {
                await axios.post(MAKE_WEBHOOK_URL, {
                    articles: results,
                    metadata: {
                        total_articles: results.length,
                        fetch_time: new Date().toISOString()
                    }
                });
                console.log('Successfully sent to Make.com');
            } catch (error) {
                console.error('Error sending to Make.com:', error.message);
            }
        }

    } catch (error) {
        console.error('\nFatal error:', error);
        process.exit(1);
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

console.log('Script starting...');
main().catch(error => {
    console.error('Main function error:', error);
    process.exit(1);
});
