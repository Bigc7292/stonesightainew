require('dotenv').config({ path: '.env' });

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_ENDPOINT = 'https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-dev/versions';

console.log('Fetching Replicate model versions...');

fetch(REPLICATE_ENDPOINT, {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + REPLICATE_API_TOKEN,
    'Accept': 'application/json'
  }
})
.then(async res => {
  console.log('Status:', res.status, res.statusText);
  const text = await res.text();
  console.log('Response:', text);
})
.catch(err => console.error('Error:', err));