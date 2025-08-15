import { Agent, User, Ticket, Rating } from '../models/index.js';

export default async function seedDatabase() {
  try {
    // Create sample agents
    const agents = await Agent.bulkCreate([
      {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'password123',
        ticketType: 'support'
      },
      {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        password: 'password123',
        ticketType: 'sales'
      }
    ]);

    // Create sample users
    const users = await User.bulkCreate([
      {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        phone: '123-456-7890',
        ticketType: 'support'
      },
      {
        name: 'Bob Williams',
        email: 'bob@example.com',
        phone: '098-765-4321',
        ticketType: 'sales'
      }
    ]);

    // Create sample tickets
    const tickets = await Ticket.bulkCreate([
      {
        id: 'Alpha-Bravo-Charlie-Delta',
        userId: users[0].id,
        ticketType: 'support',
        description: 'Cannot login to my account'
      },
      {
        id: 'Echo-Foxtrot-Golf-Hotel',
        userId: users[1].id,
        agentId: agents[1].id,
        ticketType: 'sales',
        status: 'in_progress',
        description: 'Interested in premium subscription'
      }
    ]);

    // Create sample ratings
    await Rating.bulkCreate([
      {
        ticketId: tickets[1].id,
        userId: users[1].id,
        agentId: agents[1].id,
        score: 5,
        comments: 'Excellent service!'
      }
    ]);

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Seeding error:', error);
  }
}
