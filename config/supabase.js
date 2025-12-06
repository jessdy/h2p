const { createClient } = require('@supabase/supabase-js');

/**
 * 初始化Supabase客户端
 * @returns {Object|null} Supabase客户端实例，如果配置不存在则返回null
 */
function initSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || '';
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠ Supabase credentials not found. Crawler will work in test mode (no database save).');
    console.warn('  Set SUPABASE_URL and SUPABASE_KEY environment variables to enable database saving.');
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✓ Supabase client initialized');
    return supabase;
  } catch (error) {
    console.warn('⚠ Supabase initialization failed:', error.message);
    return null;
  }
}

module.exports = {
  initSupabase,
};

