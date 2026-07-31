import { buildApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`server listening on port ${PORT}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} diterima, menutup server...`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('gagal menutup server dengan bersih:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
