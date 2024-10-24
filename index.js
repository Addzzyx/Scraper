const axios = require('axios');

const CRYPTOPANIC_API_URL = 'https://cryptopanic.com/api/posts/';
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

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
    const articles = response.data.results.slice(0, 10); // Get the first 10 articles
    console.log(`Fetched ${articles.length} articles from CryptoPanic API`);
    return articles;
  } catch (error) {
    console.error('Error fetching CryptoPanic news:', error.message);
    return [];
  }
}

async function processArticles(articles) {
  for (const article of articles) {
    console.log('-----------------------------------');
    console.log(`Title: ${article.title}`);
    console.log(`Published at: ${article.published_at}`);
    console.log(`CryptoPanic URL: ${article.url}`);
    console.log('-----------------------------------');

    // If you want to send this data to a webhook, uncomment the code below
    /*
    try {
      await axios.post(process.env.MAKE_WEBHOOK_URL, {
        title: article.title,
        published_at: article.published_at,
        cryptopanic_url: article.url
      });
      console.log(`Sent article to webhook: ${article.title}`);
    } catch (error) {
      console.error(`Error sending article "${article.title}" to webhook:`, error.message);
    }
    */

    // Pause between requests if necessary
    // await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function main() {
  const articles = await fetchTrendingNews();
  await processArticles(articles);
}

main()
  .then(() => console.log('Processing completed'))
  .catch(error => {
    console.error('An error occurred:', error.message);
    process.exit(1);
  });
