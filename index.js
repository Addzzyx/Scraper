const axios = require('axios');

const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

async function fetchRisingNews() {
  console.log('Starting API fetch...');
  
  try {
    // Configure the API request for rising news
    const response = await axios.get('https://cryptopanic.com/api/v1/posts/', {
      params: {
        auth_token: CRYPTOPANIC_API_KEY,
        filter: 'rising',  // Get rising posts
        public: 'true',
        kind: 'news',
        regions: 'en',     // English news only
        metadata: 'true'   // Include metadata
      }
    });

    const articles = response.data.results;
    
    console.log('\nResults:');
    console.log('----------------------------------------');
    console.log(`Found ${articles.length} rising articles\n`);

    // Process and display each article
    articles.forEach((article, index) => {
      console.log(`Article ${index + 1}:`);
      console.log(`Title: ${article.title}`);
      console.log(`CryptoPanic URL: ${article.url}`);
      console.log(`Published: ${new Date(article.published_at).toLocaleString()}`);
      console.log('----------------------------------------\n');
    });

    return articles;

  } catch (error) {
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    } else {
      console.error('Error fetching news:', error.message);
    }
    throw error;
  }
}

fetchRisingNews()
  .then(() => console.log('Fetch completed'))
  .catch(error => {
    console.error('An error occurred:', error);
    process.exit(1);
  });
