const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

// Add detection patterns for invalid content
const INVALID_CONTENT_PATTERNS = [
    'verify you are human',
    'complete the action below',
    'security check',
    'go back to all news',
    'review the security of your connection',
    'cloudflare',
    'please wait',
    'access denied'
];

async function scrapeArticleContent(page, url) {
    console.log(`\nAttempting to scrape: ${url}`);
    try {
        // Increase timeout and change wait strategy
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 45000 
        });

        const finalUrl = page.url();
        console.log('Resolved URL:', finalUrl);

        // Wait for content with multiple attempts
        let contentFound = false;
        for (let i = 0; i < 3; i++) {
            await page.waitForTimeout(2000);
            const hasContent = await page.evaluate(() => {
                return document.querySelector('article, .article-content, .post-content, main') !== null;
            });
            if (hasContent) {
                contentFound = true;
                break;
            }
            console.log(`Attempt ${i + 1}: Waiting for content...`);
        }

        if (!contentFound) {
            console.log('No content elements found after retries');
            return null;
        }

        // Extract content with better cleaning
        const result = await page.evaluate(() => {
            // Remove unwanted elements first
            ['script', 'style', 'nav', 'header', 'footer', 'iframe',
             '.ad', '.ads', '.social-share', '.newsletter', '.subscription',
             '.author-bio', '.related-posts', '.comments', '.navigation',
             '[class*="menu"]', '[class*="sidebar"]', '[class*="banner"]',
             'button', '[role="button"]'].forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Try to find the main content
            const selectors = [
                'article', '.article-content', '.post-content',
                '.entry-content', 'main article', '.article-body',
                '#article-body', '.story-content', '.post-body'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // Clean the content before returning
                    return element.innerText
                        .replace(/[\t\f\r]+/g, ' ')  // Remove special whitespace
                        .replace(/\n{3,}/g, '\n\n')  // Normalize line breaks
                        .replace(/\s{2,}/g, ' ')     // Normalize spaces
                        .trim();
                }
            }

            // Fallback: find largest text block
            return Array.from(document.getElementsByTagName('*'))
                .map(el => ({
                    text: el.innerText.trim(),
                    area: el.offsetWidth * el.offsetHeight,
                    depth: (function(e) {
                        let d = 0;
                        while (e.parentElement) {
                            e = e.parentElement;
                            d++;
                        }
                        return d;
                    })(el)
                }))
                .filter(({text}) => text.length > 200)
                .sort((a, b) => (b.area - a.area) || (a.depth - b.depth))
                [0]?.text || null;
        });

        if (!result) {
            console.log('No content extracted');
            return null;
        }

        // Check for invalid content patterns
        const lowerContent = result.toLowerCase();
        if (INVALID_CONTENT_PATTERNS.some(pattern => lowerContent.includes(pattern.toLowerCase()))) {
            console.log('Invalid content detected (CAPTCHA/error page)');
            return null;
        }

        // Final cleaning
        const cleanContent = result
            .replace(/RSS/gi, '')
            .replace(/Share:|Share this:|Follow us on/gi, '')
            .replace(/Related Articles:?.*$/is, '')
            .replace(/Originally published at.*$/im, '')
            .replace(/Newsletter.*$/im, '')
            .replace(/Subscribe to.*$/im, '')
            .replace(/\[\s*Read\s+More\s*\]/gi, '')
            .replace(/^\s*(RSS|HOME|NEWS|BACK|Share)\s*$/gim, '')
            .trim();

        if (cleanContent.length < 200) {
            console.log('Content too short after cleaning');
            return null;
        }

        console.log(`Successfully extracted ${cleanContent.length} characters`);
        return {
            content: cleanContent,
            source_url: finalUrl,
            word_count: cleanContent.split(/\s+/).length
        };

    } catch (error) {
        console.error('Error scraping content:', error.message);
        return null;
    }
}

// Rest of the code stays the same, just update these values:
async function processArticles(articles) {
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
            console.log(`Processing: ${article.title}`);

            const articleId = article.url.match(/\/news\/(\d+)\//)?.[1];
            if (!articleId) continue;

            const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
            const content = await scrapeArticleContent(page, externalLinkUrl);

            if (content && content.content) {
                results.push({
                    title: article.title,
                    published_at: article.published_at,
                    cryptopanic_url: article.url,
                    source_url: content.source_url,
                    content: content.content,
                    word_count: content.word_count
                });
                console.log('Article successfully processed');
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } finally {
        await browser.close();
    }

    return results;
}
