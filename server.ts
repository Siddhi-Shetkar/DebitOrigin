import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './src/server/routes/authRoutes.ts';
import appRoutes from './src/server/routes/appRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers (iframe-safe — no X-Frame-Options)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Structured API request logger
  app.use('/api', (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - started;
      console.log(
        JSON.stringify({
          level: 'info',
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs,
          timestamp: new Date().toISOString(),
        })
      );
    });
    next();
  });

  // Public health & OpenAPI-style API documentation endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      service: 'DebitOrigin',
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/docs', (_req, res) => {
    res.json({
      service: 'DebitOrigin API',
      description: 'AI-Powered Recurring Payment Consent Verification Platform',
      authentication: 'Bearer session token or Firebase ID token (with HttpOnly session cookie support)',
      endpoints: [
        'POST /api/auth/signup',
        'POST /api/auth/login',
        'POST /api/auth/google',
        'GET  /api/auth/me',
        'POST /api/auth/logout',
        'POST /api/auth/verify-email',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'GET  /api/overview',
        'GET  /api/mandates',
        'POST /api/mandates',
        'GET  /api/mandates/:id',
        'PATCH /api/mandates/:id/metadata',
        'POST /api/mandates/:id/events',
        'POST /api/documents/extract',
        'POST /api/documents/extractions/:id/commit',
        'GET  /api/verifications',
        'POST /api/verifications/simulate',
        'POST /api/verifications/:id/explain',
        'POST /api/replay',
        'GET  /api/investigations',
        'POST /api/investigations',
        'GET  /api/investigations/:id',
        'PATCH /api/investigations/:id',
        'POST /api/investigations/:id/notes',
        'GET  /api/reports',
        'GET  /api/evaluation/run',
        'POST /api/demo/load',
        'POST /api/demo/reset',
      ],
    });
  });

  // Mount API routes
  app.use('/api/auth', authRoutes);
  app.use('/api', appRoutes);

  // Unknown API route handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err);
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Uploaded file exceeds the 10 MB size limit.' });
    }
    return res.status(err?.status || 500).json({
      error: err?.message && err.status && err.status < 500
        ? err.message
        : 'An unexpected server error occurred. Please try again.',
    });
  });

  // Frontend serving: Vite dev middleware in dev, static dist in production
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DebitOrigin server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start DebitOrigin server:', err);
  process.exit(1);
});
