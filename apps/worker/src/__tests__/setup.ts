// Setup de Jest: inyecta variables de entorno dummy para que getConfig() no falle.
// Los tests unitarios no se conectan a ningún servicio real.
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.TELEGRAM_BOT_TOKEN = "123456789:TEST_TOKEN";
process.env.TELEGRAM_CHAT_ID = "-100000000";
process.env.NODE_ENV = "test";
