const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

// Verify environment variables at startup
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

        if (!response.data || !response.data.results) {
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

async function scrapeArticleContent(page, url) {
    console.log(`\nScraping: ${url}`);
    try {
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 45000 
        });

        const finalUrl = page.url();
        console.log('Redirected to:', finalUrl);

        // Wait for content with retries
        for (let i = 0; i < 3; i++) {
            await page.waitForTimeout(2000);
            const hasContent = await page.evaluate(() => {
                return !!document.querySelector('article, .article-content, .post-content, main');
            });
            if (hasContent) break;
            console.log(`Content check attempt ${i + 1}...`);
        }

        // Extract content
        const result = await page.evaluate(() => {
            // Remove unwanted elements
            [
                'script', 'style', 'nav', 'header', 'footer',
                '.ad', '.ads', '.social-share', '.newsletter',
                '[class*="menu"]', '[class*="sidebar"]'
            ].forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Try to get content
            const selectors = [
                'article',
                '.article-content',
                '.post-content',
                'main article',
                '.article-body',
                '.entry-content'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    return element.innerText.trim();
                }
            }

            // Fallback to largest text block
            return Array.from(document.getElementsByTagName('*'))
                .map(el => ({
                    text: el.innerText.trim(),
                    size: el.offsetWidth * el.offsetHeight
                }))
                .filter(({text}) => text.length > 200)
                .sort((a, b) => b.size - a.size)
                [0]?.text || null;
        });

        if (!result) {
            console.log('No content found');
            return null;
        }

        // Clean the content
        const cleanContent = result
            .replace(/\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/Go back to All News.*$/im, '')
            .replace(/Share this article:.*$/im, '')
            .replace(/Follow us on.*$/im, '')
            .trim();

        if (cleanContent.length < 200) {
            console.log('Content too short after cleaning');
            return null;
        }

        console.log(`Extracted ${cleanContent.length} characters`);
        return { content: cleanContent, source_url: finalUrl };

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
                   '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
                    content: content.content
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
            console.log('Preview:', article.content.substring(0, 150) + '...');
        });

    } catch (error) {
        console.error('\nFatal error:', error);
        process.exit(1);
    }
}

// Add global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

// Start the script
console.log('Script starting...');
main().catch(error => {
    console.error('Main function error:', error);
    process.exit(1);
});
