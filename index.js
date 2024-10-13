const { chromium } = require('playwright');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

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
            external_url: article.url,
            crypto_panic_url: article.source_url || article.url,
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
        return page.url(); // Final URL after redirects
    } catch (error) {
        console.error(`Error getting external link from ${url}:`, error.message);
        return null;
    }
}

async function scrapeArticleContent(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        const html = await page.content();
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();
        
        if (article && article.textContent) {
            return article.textContent.trim().slice(0, 1000);
        }
        
        // Fallback method
        return await page.evaluate(() => {
            const selectors = ['article', '.article-body', '.post-content', 'main', '.entry-content'];
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) return element.innerText.trim().slice(0, 1000);
            }
            return document.body.innerText.trim().slice(0, 1000);
        });
    } catch (error) {
        console.error(`Error scraping content from ${url}:`, error.message);
        return 'Failed to extract article content';
    }
}

async function scrapeAndSendNews() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const articles = await fetchTrendingNewsUrls();

    for (const article of articles) {
        let externalUrl = article.external_url;
        if (!externalUrl) {
            externalUrl = await getExternalLink(page, article.crypto_panic_url);
        }

        const content = externalUrl ? await scrapeArticleContent(page, externalUrl) : 'Failed to get external URL';

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
