const app = require('./app');
const db = require('./database/db');

const PORT = Number(process.env.PORT || 5055);
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log('=================================================');
  console.log('MEDVEIL Cryptographic API Server');
  console.log('Private Healthcare. Verifiable Claims.');
  console.log(`Listening on http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  console.log('=================================================');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    process.exit(0);
  });
});

module.exports = server;
