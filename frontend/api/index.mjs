import { createServer } from 'node:http';
import { AppServerModule } from '../dist/frontend/server/server.mjs';

export default async function handler(req, res) {
  const server = createServer(AppServerModule);
  server.emit('request', req, res);
}