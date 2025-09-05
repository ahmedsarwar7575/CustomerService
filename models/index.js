import Agent from './agent.js';
import User from './user.js';
import Ticket from './ticket.js';
import Rating from './rating.js';
import Call from './Call.js';     // ✅ import

// Agent-Ticket
Agent.hasMany(Ticket, { foreignKey: 'agentId' });
Ticket.belongsTo(Agent, { foreignKey: 'agentId' });

// User-Ticket
User.hasMany(Ticket, { foreignKey: 'userId' });
Ticket.belongsTo(User, { foreignKey: 'userId' });

// User-Call & Ticket-Call
User.hasMany(Call, { foreignKey: 'userId' });     // ✅ add
Call.belongsTo(User, { foreignKey: 'userId' });   // ✅ add
Ticket.hasMany(Call, { foreignKey: 'ticketId' }); // ✅ add
Call.belongsTo(Ticket, { foreignKey: 'ticketId' });// ✅ add

// Rating
Rating.belongsTo(User, { foreignKey: 'userId' });
Rating.belongsTo(Agent, { foreignKey: 'agentId' });
Rating.belongsTo(Ticket, { foreignKey: 'ticketId' });

export { Agent, User, Ticket, Rating, Call };
