// src/config/swagger.js
import { createRequire } from 'node:module';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const swaggerDocument = require('../swagger-output.json');

export default function setupSwagger(app) {
  // Custom Swagger CSS
  const options = {
    customCss: `
      .swagger-ui .topbar { background-color: #1e3a8a; }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .model { font-size: 14px; }
    `,
    customSiteTitle: 'Ticket Management API',
    explorer: true
  };

  // Serve Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

  // Serve JSON spec
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerDocument);
  });
  
  console.log('📚 Swagger docs available at /api-docs');
}