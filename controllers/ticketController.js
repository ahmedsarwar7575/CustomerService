import Ticket from '../models/ticket.js';
import Agent from '../models/agent.js';
import User from '../models/user.js';

// Create new ticket
export const createTicket = async (req, res) => {
  try {
    // Generate unique ticket ID (5-10 words)
    const ticketId = generateTicketId();
    
    const ticket = await Ticket.create({
      ...req.body,
      id: ticketId,
      userId: req.body.userId,
      status: 'open'
    });
    
    res.status(201).json({
      message: 'Ticket created successfully',
      ticket
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Assign ticket to agent
export const assignTicket = async (req, res) => {
  try {
    const { ticketId, agentId } = req.params;
    
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    const agent = await Agent.findByPk(agentId);
    if (!agent || !agent.isActive) {
      return res.status(404).json({ error: 'Agent not found or inactive' });
    }
    
    // Check if agent can handle this ticket type
    if (agent.ticketType !== ticket.ticketType) {
      return res.status(400).json({ 
        error: `Agent can only handle ${agent.ticketType} tickets` 
      });
    }
    
    await ticket.update({ 
      agentId,
      status: 'in_progress'
    });
    
    res.json({ 
      message: 'Ticket assigned successfully',
      ticketId: ticket.id,
      agentId: agent.id,
      agentName: `${agent.firstName} ${agent.lastName}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update ticket status
export const updateTicketStatus = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed', 'escalated'];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    
    await ticket.update({ status: req.body.status });
    res.json({ 
      message: 'Ticket status updated',
      ticketId: ticket.id,
      newStatus: req.body.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get tickets by status
export const getTicketsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const tickets = await Ticket.findAll({
      where: { status },
      include: [
        { model: Agent, attributes: ['id', 'firstName', 'lastName'] },
        { model: User, attributes: ['id', 'name', 'email'] }
      ],
      order: [['updatedAt', 'DESC']]
    });
    
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Escalate ticket
export const escalateTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findByPk(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Escalation logic would go here
    await ticket.update({ 
      status: 'escalated',
      priority: 'high'
    });
    
    res.json({ 
      message: 'Ticket escalated successfully',
      ticketId: ticket.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Helper function to generate unique ticket ID
function generateTicketId() {
  const words = [
    'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 
    'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 
    'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 
    'Yankee', 'Zulu'
  ];
  
  const length = Math.floor(Math.random() * 6) + 5; // 5-10 words
  const ticketId = Array.from({ length }, () => 
    words[Math.floor(Math.random() * words.length)]
  ).join('-');
  
  return ticketId;
}