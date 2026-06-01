require('dotenv').config();
const supabase = require('./src/models/supabaseClient');

async function check() {
  const { data, error } = await supabase.from('action_items').select('*').limit(1);
  if (error) {
    console.error('Error fetching action items:', error.message);
  } else {
    console.log('Action Item fields:', data.length > 0 ? Object.keys(data[0]) : 'No action items in DB yet');
  }
}
check();
