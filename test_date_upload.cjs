// Test date parsing and upload
const axios = require('axios');

function parseDate(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

async function testUpload() {
  const testDates = [
    '01/11/2025',  // Should be November 1st
    '15/11/2025',  // Should be November 15th
    '30/11/2025'   // Should be November 30th
  ];
  
  console.log('Testing date parsing:');
  testDates.forEach(date => {
    const parsed = parseDate(date);
    console.log(`  ${date} -> ${parsed}`);
  });
  
  console.log('\nUploading test events...');
  
  const events = testDates.map((date, i) => ({
    event_date: parseDate(date),
    program: `Test Event ${i + 1} for ${date}`,
    venue: 'Test Theatre',
    team: 'Test Team',
    sound_requirements: 'Test requirements',
    call_time: 'Test time',
    crew: 'Test Crew'
  }));
  
  try {
    const response = await axios.post('http://localhost:3000/api/events/bulk', { events });
    console.log('Upload response:', response.data);
    
    // Fetch back to verify
    const getResponse = await axios.get('http://localhost:3000/api/events');
    console.log('\nEvents in database:');
    getResponse.data.data.forEach(event => {
      console.log(`  ${event.event_date} - ${event.program}`);
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testUpload();
