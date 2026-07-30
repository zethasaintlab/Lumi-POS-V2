'use strict';

const { Client } = require('pg');

function urlFor(varName) {
  const url = process.env[varName];
  if (!url) {
    throw new Error(`${varName} tidak di-set — jalankan lewat "npm run test:isolation" (memuat .env)`);
  }
  return url;
}

async function connectAsOwner() {
  const client = new Client({ connectionString: urlFor('DATABASE_MIGRATION_URL') });
  await client.connect();
  return client;
}

async function connectAsApp() {
  const client = new Client({ connectionString: urlFor('DATABASE_URL') });
  await client.connect();
  return client;
}

module.exports = { connectAsOwner, connectAsApp };
