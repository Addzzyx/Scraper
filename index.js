const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// Sequential version (recommended)
async function processArticles(articles) {
    const browser = await chromium.launch({
        args: ['--no-sandbox']
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const processedArticles = [];

    try {
        for (const article of articles) {
            console.log('\nProcessing:', article.title);

            const articleId = extractArticleId(article.url);
            if (!articleId) continue;

            const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
            const content = await scrapeArticleContent(page, externalLinkUrl);

            if (content) {
                const processedArticle = {
                    title: article.title,
                    published_at: article.published_at,
                    cryptopanic_url: article.url,
                    source_url: content.source,
                    content: content.content,
                    word_count: content.wordCount
                };

                processedArticles.push(processedArticle);

                // If Make.com webhook URL is configured, send the article
                if (MAKE_WEBHOOK_URL) {
                    try {
                        await axios.post(MAKE_WEBHOOK_URL, processedArticle);
                        console.log('Article sent to Make.com successfully');
                    } catch (webhookError) {
                        console.error('Error sending to Make.com:', webhookError.message);
                    }
                }
            }

            // Rate limiting between articles
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } finally {
        await browser.close();
    }

    return processedArticles;
}

// Alternative parallel version (if you want to experiment)
async function processArticlesParallel(articles, maxConcurrent = 2) {
    const browser = await chromium.launch({
        args: ['--no-sandbox']
    });
    
    try {
        // Process articles in chunks to control concurrency
        const chunks = [];
        for (let i = 0; i < articles.length; i += maxConcurrent) {
            chunks.push(articles.slice(i, i + maxConcurrent));
        }

        const processedArticles = [];
        
        for (const chunk of chunks) {
            // Process each chunk in parallel
            const promises = chunk.map(async (article) => {
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                              '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
                });
                const page = await context.newPage();

                try {
                    const articleId = extractArticleId(article.url);
                    if (!articleId) return null;

                    const externalLinkUrl = `https://cryptopanic.com/news/click/${articleId}/`;
                    const content = await scrapeArticleContent(page, externalLinkUrl);

                    if (content) {
                        const processedArticle = {
                            title: article.title,
                            published_at: article.published_at,
                            cryptopanic_url: article.url,
                            source_url: content.source,
                            content: content.content,
                            word_count: content.wordCount
                        };

                        if (MAKE_WEBHOOK_URL) {
                            try {
                                await axios.post(MAKE_WEBHOOK_URL, processedArticle);
                                console.log(`Article sent to Make.com: ${article.title}`);
                            } catch (webhookError) {
                                console.error('Error sending to Make.com:', webhookError.message);
                            }
                        }

                        return processedArticle;
                    }
                } catch (error) {
                    console.error(`Error processing article: ${article.title}`, error);
                    return null;
                } finally {
                    await page.close();
                    await context.close();
                }
            });

            const results = await Promise.allSettled(promises);
            const successfulResults = results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);
            processedArticles.push(...successfulResults);

            // Rate limiting between chunks
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        return processedArticles;
    } finally {
        await browser.close();
    }
}

async function scrapeArticleContent(page, url) {
    console.log(`\nAttempting to scrape content from: ${url}`);
    try {
        await page.goto(url, { 
            waitUntil: 'networkidle',
            timeout: 60000 
        });

        await page.waitForLoadState('domcontentloaded');
        
        const finalUrl = page.url();
        console.log('Final URL after redirects:', finalUrl);

        const html = await page.content();
        const dom = new JSDOM(html, { url: finalUrl });
        const reader = new Readability(dom.window.document, {
            charThreshold: 100,
            classesToPreserve: ['article-content', 'post-content']
        });

        const article = reader.parse();
        
        if (!article) {
            console.log('No article content found');
            return null;
        }

        let cleanContent = article.textContent
            .replace(/\s+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .replace(/Go back to All News/gi, '')
            .replace(/RSS/gi, '')
            .replace(/Share:/gi, '')
            .replace(/\d+ min read/gi, '')
            .replace(/Follow us on .+/gi, '')
            .replace(/Share on .+/gi, '')
            .replace(/Related Articles.+/gi, '')
            .replace(/About the Author.+/gi, '')
            .trim();

        const unwantedPhrases = [
            'Disclaimer:',
            'The opinions expressed',
            'The views and opinions',
            'The information provided',
            'This article is for informational purposes',
            'Author',
            'Let\'s talk web3'
        ];

        unwantedPhrases.forEach(phrase => {
            const index = cleanContent.indexOf(phrase);
            if (index !== -1) {
                cleanContent = cleanContent.substring(0, index).trim();
            }
        });

        if (cleanContent.length < 100) {
            console.log('Content too short after cleaning');
            return null;
        }

        return {
            title: article.title,
            content: cleanContent,
            excerpt: cleanContent.substring(0, 200) + '...',
            wordCount: cleanContent.split(/\s+/).length,
            source: finalUrl
        };

    } catch (error) {
        console.error('Error during content scraping:', error);
        return null;
    }
}

function extractArticleId(cryptopanicUrl) {
    const regex = /\/news\/(\d+)\//;
    const match = cryptopanicUrl.match(regex);
    return match?.[1] || null;
}

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

async function main() {
    try {
        const articles = await fetchTrendingNews();
        if (articles.length === 0) {
            console.error('No articles fetched, exiting...');
            process.exit(1);
        }

        // Use the sequential version by default
        const processedArticles = await processArticles(articles);
        // Or use the parallel version if you want to experiment
        // const processedArticles = await processArticlesParallel(articles, 2);

        console.log(`\nSuccessfully processed ${processedArticles.length} articles`);
    } catch (error) {
        console.error('Fatal error in main execution:', error);
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
    process.exit(1);
});

main();
