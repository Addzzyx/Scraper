const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

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
        console.error('Error fetching CryptoPanic news:', error.message);
        return [];
    }
}

async function scrapeArticleContent(page, url) {
    console.log(`\nAttempting to scrape: ${url}`);
    try {
        // Navigate to the URL and wait for content to load
        await page.goto(url, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // Get final URL after redirects
        const finalUrl = page.url();
        console.log('Resolved URL:', finalUrl);

        // Wait for any dynamic content
        await page.waitForTimeout(2000);

        // Extract content using a single evaluate call
        const result = await page.evaluate(() => {
            // First remove unwanted elements
            const unwantedElements = [
                'script', 'style', 'nav', 'header', 'footer',
                '.ad', '.ads', '.social-share', '.newsletter',
                '.subscription', '[class*="ads-"]', '[class*="social"]'
            ];

            unwantedElements.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Common article selectors in order of preference
            const selectors = [
                'article',
                '[role="article"]',
                '.article-content',
                '.post-content',
                '.entry-content',
                'main article',
                '.article-body',
                '#article-body',
                '.story-content',
                '.main-content',
                '.content'
            ];

            // Try each selector
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const text = element.innerText;
                    if (text.length > 100) {
                        return text;
                    }
                }
            }

            // Fallback: find the largest text container
            const textBlocks = Array.from(document.getElementsByTagName('*'))
                .map(el => ({
                    element: el,
                    text: el.innerText.trim(),
                    depth: (function getDepth(e) {
                        let depth = 0;
                        while (e.parentElement) {
                            e = e.parentElement;
                            depth++;
                        }
                        return depth;
                    })(el)
                }))
                .filter(({ text }) => text.length > 200)
                .sort((a, b) => {
                    // Prefer elements with more text and less depth
                    const textDiff = b.text.length - a.text.length;
                    const depthDiff = a.depth - b.depth;
                    return textDiff || depthDiff;
                });

            return textBlocks.length > 0 ? textBlocks[0].text : null;
        });

        if (!result) {
            console.log('No content found');
            return null;
        }

        // Clean up the content
        const cleanContent = result
            .replace(/\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/Related Articles:.*$/is, '')
            .replace(/Share this article:.*$/is, '')
            .replace(/Follow us on.*$/is, '')
            .trim();

        console.log(`Successfully extracted ${cleanContent.length} characters`);
        return {
            content: cleanContent,
            source_url: finalUrl
        };

    } catch (error) {
        console.error('Error scraping content:', error.message);
        return null;
    }
}

async function processArticles(articles) {
    const browser = await chromium.launch({
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
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

            // Rate limiting between requests
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } finally {
        await browser.close();
    }

    return results;
}

async function main() {
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
        
        processedArticles.forEach((article, index) => {
            console.log(`\n[Article ${index + 1}] ${article.title}`);
            console.log(`Source: ${article.source_url}`);
            console.log(`Content Length: ${article.content.length} characters`);
            console.log('Preview:', article.content.substring(0, 200));
        });

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

main();
