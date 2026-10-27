// Entry point for the Neon Function (production)
import { upgradeWebSocket } from '@neon/functions';
import { createApp } from './app.js';

export default createApp({ upgrade: (request) => upgradeWebSocket(request) });
