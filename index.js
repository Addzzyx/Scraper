const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// Verify API key at startup
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
                    const selectors = [
                        'article',
                        '.article-content',
                        '.post-content',
                        'main',
                        '.content',
                        '#article-body'
                    ];
                    return selectors.some(selector => 
                        document.querySelector(selector) !== null
                    );
                });
                if (contentFound) break;
            } catch (e) {
                console.log(`Attempt ${i + 1} failed:`, e.message);
            }
            console.log(`Content check attempt ${i + 1}...`);
        }

        // Check for security measures
        const pageText = await page.evaluate(() => 
            document.body.innerText.toLowerCase()
        );

        const blockPhrases = [
            'verify you are human',
            'security check',
            'captcha',
            'access denied',
            'cloudflare',
            'ddos protection'
        ];

        if (blockPhrases.some(phrase => pageText.includes(phrase))) {
            console.log('Security check detected, skipping');
            return null;
        }

        // Extract content
        const result = await page.evaluate(() => {
            // Remove unwanted elements
            const unwanted = [
                'script', 'style', 'nav', 'header', 'footer',
                '.ad', '.ads', '.social-share', '.newsletter',
                '.sidebar', '.menu', '.navigation', '.author-bio',
                '.related-posts', '.comments', '[class*="advertisement"]',
                '[class*="social"]', '[class*="share"]', '[class*="menu"]',
                'iframe', '.toolbar', '.tools'
            ];
            
            unwanted.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            });

            // Try to find main content
            const selectors = [
                'article',
                '.article-content',
                '.post-content',
                '.entry-content',
                'main article',
                '#article-body',
                '.story-content',
                '.content',
                '[role="article"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    let text = element.innerText || '';
                    if (text.length > 500) {
                        return text
                            .replace(/\s+/g, ' ')
                            .replace(/\n{2,}/g, '\n')
                            .trim();
                    }
                }
            }

            // Fallback: find largest text block
            const blocks = Array.from(document.getElementsByTagName('*'))
                .map(el => ({
                    text: (el.innerText || '').trim(),
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
                .filter(({text}) => text.length > 500)
                .sort((a, b) => (b.area - a.area) || (a.depth - b.depth));

            return blocks[0]?.text || null;
        });

        if (!result) {
            console.log('No substantial content found');
            return null;
        }

        // Clean the content
        const cleanContent = result
            .replace(/^(Go back to All News|RSS|Share this article|Home|News)(\s|$)/gm, '')
            .replace(/Related Articles:.*$/s, '')
            .replace(/Share this article:.*$/s, '')
            .replace(/Originally published at.*$/m, '')
            .replace(/Newsletter.*$/m, '')
            .replace(/Follow us on.*$/m, '')
            .replace(/Read more:.*$/m, '')
            .replace(/(Tags:|Categories:).*$/m, '')
            .replace(/^Advertisement/gm, '')
            .trim();

        if (cleanContent.length < 500) {
            console.log('Content too short after cleaning');
            return null;
        }

        console.log(`Extracted ${cleanContent.length} characters`);
        return {
            content: cleanContent,
            source_url: finalUrl,
            word_count: cleanContent.split(/\s+/).length
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
