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
        id: 1,
        userId: users[0].id,
        ticketType: 'support',
        description: 'Email not working',
        
      },
      {
        id: 2,
        userId: users[0].id,
        ticketType: 'support',
        description: 'How can i add user?'
      },
      {
        id: 3,
        userId: users[0].id,
        ticketType: 'support',
        description: 'Cannot login to my account'
      },
      {
        id: 4,
        userId: users[1].id,
        ticketType: 'sales',
        description: 'Cannot login to my dashboard'
      },
      {
        id: 5,
        userId: users[0].id,
        ticketType: 'support',
        description: 'signup failed'
      },
      {
        id: 6,
        userId: users[1].id,
        ticketType: 'support',
        description: 'How much for pro account?'
      },
      {
        id: 7,
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
seedDatabase()