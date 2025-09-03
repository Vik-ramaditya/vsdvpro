/**
 * Payment Synchronization Test Script
 * Tests the core payment functionality via API calls
 */

const API_BASE = 'http://localhost:3000/api';

async function makeRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    return { success: response.ok, status: response.status, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testDatabaseConnection() {
  console.log('🔍 Testing database connection...');
  const result = await makeRequest('/test-db');
  
  if (result.success) {
    console.log('✅ Database connection successful');
    console.log(`   Found ${result.data.count} variants in database`);
    return true;
  } else {
    console.log('❌ Database connection failed:', result.error);
    return false;
  }
}

async function testStockUnits() {
  console.log('🔍 Testing stock units...');
  const result = await makeRequest('/test-stock-units');
  
  if (result.success) {
    console.log('✅ Stock units test successful');
    console.log(`   Stock units data:`, result.data);
    return true;
  } else {
    console.log('❌ Stock units test failed:', result.error);
    return false;
  }
}

async function testUnitSkus() {
  console.log('🔍 Testing unit SKUs...');
  const result = await makeRequest('/test-unit-skus');
  
  if (result.success) {
    console.log('✅ Unit SKUs test successful');
    console.log(`   Unit SKU tests:`, result.data.unit_sku_tests);
    return true;
  } else {
    console.log('❌ Unit SKUs test failed:', result.error);
    return false;
  }
}

async function createTestUnit() {
  console.log('🔍 Creating test unit...');
  const result = await makeRequest('/create-test-unit', 'POST');
  
  if (result.success) {
    console.log('✅ Test unit created successfully');
    console.log(`   Created units:`, result.data.results);
    return result.data;
  } else {
    console.log('❌ Test unit creation failed:', result.error);
    return null;
  }
}

async function runTests() {
  console.log('🧪 Starting Payment Synchronization API Tests...\n');
  
  const results = {
    databaseConnection: false,
    stockUnits: false,
    unitSkus: false,
    testUnitCreation: false
  };
  
  // Test 1: Database Connection
  results.databaseConnection = await testDatabaseConnection();
  console.log('');
  
  // Test 2: Stock Units
  results.stockUnits = await testStockUnits();
  console.log('');
  
  // Test 3: Unit SKUs
  results.unitSkus = await testUnitSkus();
  console.log('');
  
  // Test 4: Create Test Unit
  const testUnitResult = await createTestUnit();
  results.testUnitCreation = !!testUnitResult;
  console.log('');
  
  // Summary
  console.log('📊 Test Summary:');
  console.log('================');
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  console.log(`Database Connection: ${results.databaseConnection ? '✅' : '❌'}`);
  console.log(`Stock Units: ${results.stockUnits ? '✅' : '❌'}`);
  console.log(`Unit SKUs: ${results.unitSkus ? '✅' : '❌'}`);
  console.log(`Test Unit Creation: ${results.testUnitCreation ? '✅' : '❌'}`);
  console.log(`\nOverall: ${passed}/${total} tests passed (${((passed/total)*100).toFixed(1)}%)`);
  
  if (passed === total) {
    console.log('\n🎉 All API tests passed! The database and core functionality are working.');
    console.log('\n📝 Next Steps:');
    console.log('1. Run the database migration to fix payment_entries schema');
    console.log('2. Test payment entry creation with walk-in customers');
    console.log('3. Verify payment status synchronization');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the database setup and configuration.');
  }
  
  return results;
}

// Run the tests
runTests().catch(console.error);
