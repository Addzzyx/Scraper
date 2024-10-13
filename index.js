const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Step 1: Go to CryptoPanic's trending section (you can adjust the URL for top/trending)
    await page.goto('https://cryptopanic.com/news/trending/');

    // Step 2: Get the top 3 article links (you can loop for more or adjust the number)
    const articleLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.title a')).slice(0, 3).map(link => ({
            title: link.innerText,
            href: link.href
        }));
    });

    console.log('Trending Articles:', articleLinks);

    let articlesData = [];

    for (const article of articleLinks) {
        try {
            // Step 3: Navigate to the external article
            await page.goto(article.href);

            // Step 4: Scrape the full article (adjust selectors for different websites)
            const fullArticle = await page.evaluate(() => {
                // Change this selector based on the source website's structure
                const articleContent = document.querySelector('div.article-content');
                return articleContent ? articleContent.innerText : 'No content found';
            });

            console.log(`Article from ${article.href}:`, fullArticle);

            // Collect data for Make.com
            articlesData.push({
                title: article.title,
                link: article.href,
                fullArticle: fullArticle
            });
        } catch (err) {
            console.error(`Error scraping ${article.href}:`, err);
        }
    }

    // Step 5: Send the collected articles data to Make.com webhook (Replace with your actual webhook URL)
    await axios.post('https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p', {
        articles: articlesData
    });

    // Close the browser
    await browser.close();
})();
