import { buildApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`server listening on port ${PORT}`);
