import Agent from './agent.js';
import User from './user.js';
import Ticket from './ticket.js';
import Rating from './rating.js';

// Agent-Ticket relationship (One-to-Many)
Agent.hasMany(Ticket, { foreignKey: 'agentId' });
Ticket.belongsTo(Agent, { foreignKey: 'agentId' });

// User-Ticket relationship (One-to-Many)
User.hasMany(Ticket, { foreignKey: 'userId' });
Ticket.belongsTo(User, { foreignKey: 'userId' });

// Rating relationships
Rating.belongsTo(User, { foreignKey: 'userId' });
Rating.belongsTo(Agent, { foreignKey: 'agentId' });
Rating.belongsTo(Ticket, { foreignKey: 'ticketId' });

export { Agent, User, Ticket, Rating };