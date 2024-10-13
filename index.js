const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Navigate to the page you want to scrape
    await page.goto('https://cryptopanic.com/news/19997988/Whales-Hoard-90-Million-In-Bitcoin-A-Sign-Of-Whats-To-Come');

    // Wait for the element containing the article description
    const articleDescription = await page.locator('.description-body p').innerText();

    console.log('Article Description:', articleDescription);

    // Post the scraped data to your Make.com webhook
    await axios.post('https://hook.eu2.make.com/1m8yqc7djp5n424luitgca3m6sch4c0p', {
        articleDescription: articleDescription
    });

    // Close the browser
    await browser.close();
})();
