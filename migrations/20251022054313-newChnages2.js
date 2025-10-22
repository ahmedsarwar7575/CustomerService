'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (q, Sequelize) {
    // table name per your SQL logs: `users`
    const table = await q.describeTable('users');

    const ops = [];
    if (!table.isUpSellCall) {
      ops.push(q.addColumn('users', 'isUpSellCall', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }));
    }
    if (!table.isSatisfactionCall) {
      ops.push(q.addColumn('users', 'isSatisfactionCall', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }));
    }
    if (!table.isBothCall) {
      ops.push(q.addColumn('users', 'isBothCall', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }));
    }

    await Promise.all(ops);
  },

  async down (q) {
    const table = await q.describeTable('users');
    const ops = [];
    if (table.isUpSellCall)        ops.push(q.removeColumn('users', 'isUpSellCall'));
    if (table.isSatisfactionCall)  ops.push(q.removeColumn('users', 'isSatisfactionCall'));
    if (table.isBothCall)          ops.push(q.removeColumn('users', 'isBothCall'));
    await Promise.all(ops);
  }
};
