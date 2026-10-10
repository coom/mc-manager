import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, please try again later' } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/refresh', authLimiter);
  app.use('/api/setup/init', authLimiter);
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

  // Les routes sont montées ici par les tâches suivantes, dans cet ordre :
  // publiques (/api/setup, /api/auth), puis app.use('/api', authMiddleware), puis les routes protégées.

  app.use(errorHandler);
  return app;
}
