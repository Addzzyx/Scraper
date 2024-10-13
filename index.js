const { chromium } = require('playwright');
const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/v1/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p';

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
        return response.data.results.slice(0, 10).map(article => ({
            title: article.title,
            crypto_panic_url: article.url,
            source_name: article.source.title,
            published_at: article.published_at
        }));
    } catch (error) {
        console.error('Error fetching CryptoPanic news:', error.message);
        return [];
    }
}

async function getExternalLink(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        
        // Extract the redirect URL
        const redirectUrl = await page.evaluate(() => {
            const link = document.querySelector('a[href^="/news/click/"]');
            return link ? new URL(link.getAttribute('href'), window.location.origin).href : null;
        });

        if (redirectUrl) {
            // Follow the redirect
            await page.goto(redirectUrl, { waitUntil: 'networkidle', timeout: 60000 });
            return page.url(); // This will be the final URL after redirect
        }

        return null;
    } catch (error) {
        console.error(`Error getting external link from ${url}:`, error.message);
        return null;
    }
}

async function scrapeArticleContent(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        
        const content = await page.evaluate(() => {
            const selectors = [
                'article',
                '.article-body',
                '.post-content',
                'main',
                '.entry-content',
                '#content'
            ];
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) return element.innerText.trim();
            }
            // If no matching selector, try to get all paragraph text
            const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.innerText).join('\n\n');
            return paragraphs || 'Failed to extract article content';
        });

        return content.slice(0, 1000) + (content.length > 1000 ? '...' : '');
    } catch (error) {
        console.error(`Error scraping content from ${url}:`, error.message);
        return 'Failed to extract article content';
    }
}

async function scrapeAndSendNews() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const articles = await fetchTrendingNewsUrls();

    console.log(`Fetched ${articles.length} articles from CryptoPanic API`);

    for (const article of articles) {
        console.log(`Processing article: ${article.title}`);
        
        const externalUrl = await getExternalLink(page, article.crypto_panic_url);
        console.log(`Original URL: ${article.crypto_panic_url}`);
        console.log(`External URL: ${externalUrl}`);

        let content = 'Failed to extract content';
        if (externalUrl) {
            content = await scrapeArticleContent(page, externalUrl);
            console.log(`Scraped content length: ${content.length} characters`);
        }

        const scrapedArticle = {
            title: article.title,
            original_url: article.crypto_panic_url,
            source_url: externalUrl || 'N/A',
            source_name: article.source_name,
            published_at: article.published_at,
            content: content
        };

        try {
            await axios.post(MAKE_WEBHOOK_URL, scrapedArticle);
            console.log(`Sent to webhook: ${article.title}`);
        } catch (error) {
            console.error(`Failed to send to webhook: ${article.title}`, error.message);
        }
    }

    await browser.close();
}

scrapeAndSendNews()
    .then(() => console.log('Scraping completed'))
    .catch(error => {
        console.error('An error occurred during scraping:', error.message);
    });
