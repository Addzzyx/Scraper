const axios = require('axios');
const cheerio = require('cheerio');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/v1/posts/';

async function fetchTopNewsUrls() {
  const apiKey = '59abb8cd1cee2a0f087b0299a24c6f3a71665213';
  const params = {
    auth_token: apiKey,
    filter: 'popular',
    public: 'true',
    kind: 'news',
    regions: 'en',
    timeframe: '48h'
  };

  try {
    const response = await axios.get(CRYPTOPANIC_API_URL, { params });
    return response.data.results.slice(0, 10).map(article => ({
      title: article.title,
      url: article.url,
      published_at: article.published_at,
      sentiment: article.votes
    }));
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function scrapeArticleContent(url) {
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const $ = cheerio.load(response.data);
    
    let content = $('.description .description-body p').text().trim();
    
    if (!content) {
      content = $('article p').text().trim() || $('body p').text().trim();
    }

    return content || 'No content found.';
  } catch (error) {
    console.error(`Error scraping content from ${url}:`, error.message);
    return `Error fetching content: ${error.message}`;
  }
}

async function fetchAndScrapeNews() {
  const articles = await fetchTopNewsUrls();
  const scrapedArticles = await Promise.all(articles.map(async (article, index) => {
    const content = await scrapeArticleContent(article.url);
    return {
      rank: index + 1,
      ...article,
      content: content
    };
  }));

  return scrapedArticles;
}

// Execute the function and log results
fetchAndScrapeNews().then(news => {
  news.forEach(article => {
    console.log(`Rank: ${article.rank}`);
    console.log(`Title: ${article.title}`);
    console.log(`URL: ${article.url}`);
    console.log(`Published at: ${article.published_at}`);
    console.log(`Sentiment:`, article.sentiment);
    console.log(`Content: ${article.content}`);
    console.log('\n' + '-'.repeat(50) + '\n');
  });
}).catch(error => {
  console.error('Error:', error.message);
});
