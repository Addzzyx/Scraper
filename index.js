const axios = require('axios');

const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY;

async function fetchRisingNews() {
  console.log('Starting API fetch...');
  
  try {
    // Use the correct endpoint and remove PRO-only parameters
    const response = await axios.get('https://cryptopanic.com/api/v1/posts/', {
      params: {
        auth_token: CRYPTOPANIC_API_KEY,
        filter: 'rising',
        currencies: 'all',
        kind: 'news',
        public: true,
        regions: 'en'
      },
      headers: {
        'Accept': 'application/json'
      }
    });

    const articles = response.data.results;
    
    console.log('\nResults:');
    console.log('----------------------------------------');
    console.log(`Found ${articles.length} rising articles\n`);

    // Process and display each article
    articles.forEach((article, index) => {
      // Use the CryptoPanic URL format
      const cryptoPanicUrl = `https://cryptopanic.com/news/${article.id}/`;
      
      console.log(`Article ${index + 1}:`);
      console.log(`Title: ${article.title}`);
      console.log(`CryptoPanic URL: ${cryptoPanicUrl}`);
      console.log(`Published: ${new Date(article.published_at).toLocaleString()}`);
      console.log('----------------------------------------\n');
    });

    return articles;

  } catch (error) {
    if (error.response) {
      console.error('API Error Status:', error.response.status);
      console.error('API Error Data:', error.response.data);
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Error:', error.message);
    }
    throw error;
  }
}

fetchRisingNews()
  .then(() => {
    console.log('Fetch completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Failed to complete fetch');
    process.exit(1);
  });
