// swagger-gen.mjs
import swaggerAutogen from 'swagger-autogen';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const doc = {
  info: {
    title: 'Ticket Management API',
    version: '1.0.0',
    description: 'Comprehensive ticket management system with agent and user management',
  },
  servers: [
    { 
      url: 'http://localhost:3000',
      description: 'Development server' 
    }
  ],
  tags: [
    { name: 'Agents', description: 'Agent management operations' },
    { name: 'Tickets', description: 'Ticket management operations' },
    { name: 'Users', description: 'User management operations' },
    { name: 'Ratings', description: 'Rating management operations' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Use agent JWT token for authentication'
      }
    },
    schemas: {
      Agent: {
        type: 'object',
        properties: {
          firstName: { type: 'string', example: 'John' },
          lastName: { type: 'string', example: 'Doe' },
          email: { type: 'string', format: 'email', example: 'john@example.com' },
          password: { type: 'string', example: 'securepassword123' },
          isActive: { type: 'boolean', example: true },
          rating: { type: 'number', format: 'float', example: 4.5 },
          ticketType: { 
            type: 'string', 
            enum: ['support', 'sales', 'billing'],
            example: 'support'
          }
        }
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'Alpha-Bravo-Charlie-Delta' },
          status: { 
            type: 'string', 
            enum: ['open', 'in_progress', 'resolved', 'closed', 'escalated'],
            example: 'open'
          },
          ticketType: { 
            type: 'string', 
            enum: ['support', 'sales', 'billing'],
            example: 'support'
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            example: 'medium'
          },
          description: { type: 'string', example: 'Cannot login to my account' }
        }
      },
      // Add other schemas as needed
    }
  },
  security: [{ BearerAuth: [] }]
};

const outputFile = './swagger-output.json';
const endpointsFiles = [
  path.join(__dirname, 'routes/api.js') // Only include your API routes file
];

swaggerAutogen({ 
  openapi: '3.0.0',
  autoHeaders: true,
  autoQuery: true,
  autoBody: true
})(outputFile, endpointsFiles, doc).then(() => {
  console.log('✅ swagger-output.json generated successfully');
});