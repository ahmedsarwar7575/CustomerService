import Rating from '../models/rating.js';
import Ticket from '../models/ticket.js';
import Agent from '../models/agent.js';

// Create rating for a ticket
export const createRating = async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    const ticket = await Ticket.findByPk(ticketId, {
      include: [Agent]
    });
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    if (!ticket.agentId) {
      return res.status(400).json({ error: 'Ticket not assigned to an agent' });
    }
    
    const rating = await Rating.create({
      ...req.body,
      userId: ticket.userId,
      agentId: ticket.agentId,
      ticketId: ticket.id
    });
    
    // Update agent's average rating
    await updateAgentRating(ticket.agentId);
    
    res.status(201).json({
      message: 'Rating submitted successfully',
      rating
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get ratings for an agent
export const getAgentRatings = async (req, res) => {
  try {
    const { agentId } = req.params;
    const ratings = await Rating.findAll({
      where: { agentId },
      include: [
        { model: Ticket, attributes: ['id', 'description'] },
        { model: Agent, attributes: ['firstName', 'lastName'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(ratings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Helper function to update agent's average rating
async function updateAgentRating(agentId) {
  const ratings = await Rating.findAll({ where: { agentId } });
  
  if (ratings.length === 0) return;
  
  const totalScore = ratings.reduce((sum, rating) => sum + rating.score, 0);
  const averageRating = totalScore / ratings.length;
  
  await Agent.update(
    { rating: averageRating },
    { where: { id: agentId } }
  );
}