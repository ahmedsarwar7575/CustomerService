import User from '../models/user.js';
import Ticket from '../models/ticket.js';
import Call from '../models/Call.js';
import Rating from '../models/rating.js';
import {Email} from '../models/Email.js';


// Create new user
export const createUser = async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json({
      message: 'User created successfully',
      user
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
// Get user with tickets
export const getUserWithTickets = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{
        model: Ticket,
        attributes: ['id', 'status', 'ticketType', 'priority', 'createdAt']
      }]
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const user = await User.findAll();
    
    if (!user) {
      return res.status(404).json({ error: 'Users not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// Update user status
export const updateUserStatus = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const validStatuses = ['active', 'inactive', 'pending'];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    
    await user.update({ status: req.body.status });
    res.json({ 
      message: 'User status updated',
      userId: user.id,
      newStatus: req.body.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get users by ticket type
export const getUsersByTicketType = async (req, res) => {
  try {
    const { ticketType } = req.params;
    const users = await User.findAll({
      where: { ticketType },
      attributes: ['id', 'name', 'email', 'phone', 'status'],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'User id is required' });
    }

    const ticket = await Ticket.findOne({
      where: { userId: id, status: 'open' },
    });

    if (ticket) {
      return res
        .status(400)
        .json({ error: 'User has open tickets. Please delete them first' });
    }

    await Call.destroy({ where: { userId: id } });
    await Email.destroy({ where: { userId: id } });
    await Rating.destroy({ where: { userId: id } });

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.destroy();

    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: error.message });
  }
};