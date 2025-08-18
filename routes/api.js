import express from 'express';
import {
  login as agentLogin,
  createAgent,
  getAllAgents,
  getAgentById,
  updateAgent,
  deactivateAgent,
  getAgentPerformance,
  adminLogin
} from '../controllers/agentController.js';
import {
  createTicket,
  assignTicket,
  updateTicketStatus,
  getTicketsByStatus,
  escalateTicket,
  getAllTickets
} from '../controllers/ticketController.js';
import {
  createUser,
  getUserWithTickets,
  updateUserStatus,
  getUsersByTicketType,
  getAllUsers
} from '../controllers/userController.js';
import {
  createRating,
  getAgentRatings,
  getAllRatings
} from '../controllers/ratingController.js';

const router = express.Router();

// Agent Routes
router.post('/api/login', /* #swagger.tags = ['Agents'] */ agentLogin);
router.post('/api/agents', /* #swagger.tags = ['Agents'] */   createAgent);
router.get('/api/agents', /* #swagger.tags = ['Agents'] */  getAllAgents);
router.get('/api/agents/:id', /* #swagger.tags = ['Agents'] */  getAgentById);
router.put('/api/agents/:id', /* #swagger.tags = ['Agents'] */  updateAgent);
router.delete('/api/agents/:id', /* #swagger.tags = ['Agents'] */   deactivateAgent);
router.get('/api/agents/:id/performance', /* #swagger.tags = ['Agents'] */  getAgentPerformance);
router.get('/api/adminLogin', /* #swagger.tags = ['Agents'] */  adminLogin);


// Ticket Routes
router.post('/api/tickets', /* #swagger.tags = ['Tickets'] */  createTicket);
router.patch('/api/tickets/:ticketId/assign/:agentId', /* #swagger.tags = ['Tickets'] */  assignTicket);
router.patch('/api/tickets/:id/status', /* #swagger.tags = ['Tickets'] */  updateTicketStatus);
router.get('/api/tickets/status/:status', /* #swagger.tags = ['Tickets'] */  getTicketsByStatus); 
router.get('/api/tickets', /* #swagger.tags = ['Tickets'] */  getAllTickets); 
router.patch('/api/tickets/:id/escalate', /* #swagger.tags = ['Tickets'] */  escalateTicket);

// User Routes
router.post('/api/users', /* #swagger.tags = ['Users'] */ createUser);
router.get('/api/users/:id', /* #swagger.tags = ['Users'] */  getUserWithTickets);
router.patch('/api/users/:id/status', /* #swagger.tags = ['Users'] */  updateUserStatus);
router.get('/api/users/type/:ticketType', /* #swagger.tags = ['Users'] */  getUsersByTicketType);
router.get('/api/users', /* #swagger.tags = ['Users'] */  getAllUsers);

// Rating Routes
router.post('/api/tickets/:ticketId/ratings', /* #swagger.tags = ['Ratings'] */ createRating);
router.get('/api/agents/:agentId/ratings', /* #swagger.tags = ['Ratings'] */  getAgentRatings);
router.get('/api/ratings', /* #swagger.tags = ['Ratings'] */  getAllRatings);

export default router;