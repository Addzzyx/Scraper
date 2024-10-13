const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Navigate to the page you want to scrape (e.g., trending articles on CryptoPanic)
    await page.goto('https://cryptopanic.com/');

    // Wait for the news item titles
    await page.waitForSelector('.news-item .title a');

    // Scrape the top 3 article titles and links
    const articleLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.news-item .title a')).slice(0, 3).map(link => ({
            title: link.innerText,
            href: link.href
        }));
    });

    // Now, for each article, scrape its metadata
    const articlesWithMeta = [];
    for (const article of articleLinks) {
        await page.goto(article.href);

        const metadata = await page.evaluate(() => {
            const getMetaTag = (name) => document.querySelector(`meta[name="${name}"]`)?.content || document.querySelector(`meta[property="${name}"]`)?.content || '';

            return {
                title: document.title,
                description: getMetaTag('description'),
                ogTitle: getMetaTag('og:title'),
                ogImage: getMetaTag('og:image'),
                ogDescription: getMetaTag('og:description')
            };
        });

        articlesWithMeta.push({ ...article, ...metadata });
    }

    console.log('Scraped Articles with Metadata:', articlesWithMeta);

    // Send the scraped articles and metadata to Make.com
    await axios.post('https://hook.eu2.make.com/your-custom-webhook-url', {
        articles: articlesWithMeta
    });

    // Close the browser
    await browser.close();
})();
