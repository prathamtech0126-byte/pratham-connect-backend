// Quick test script to verify the optimized endpoints
const http = require('http');

const BASE_URL = 'http://localhost:5000'; // Adjust port if different

// You'll need to replace this with a valid auth token
const AUTH_TOKEN = 'YOUR_JWT_TOKEN_HERE';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`\n${path}:`);
          console.log(`Status: ${res.statusCode}`);
          console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
          resolve(parsed);
        } catch (e) {
          console.log(`\n${path}: Status ${res.statusCode}`);
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`Error calling ${path}:`, err.message);
      reject(err);
    });

    req.end();
  });
}

async function testEndpoints() {
  console.log('Testing optimized endpoints...\n');
  
  try {
    // Test sale-dashboard with yearly filter
    await makeRequest('/api/reports/sale-dashboard?filter=yearly');
    
    // Test sale-graph-report with yearly filter
    await makeRequest('/api/reports/sale-graph-report?metric=core_sale&filter=yearly');
    
    // Test overall report
    await makeRequest('/api/reports?filter=yearly');
    
    console.log('\n✅ All endpoints tested successfully!');
  } catch (err) {
    console.error('\n❌ Some endpoints failed:', err.message);
  }
}

testEndpoints();
