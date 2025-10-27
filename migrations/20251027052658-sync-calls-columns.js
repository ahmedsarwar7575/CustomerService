"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("calls");

    const add = (name, spec) =>
      table[name]
        ? Promise.resolve()
        : queryInterface.addColumn("calls", name, spec);

    await add("type", {
      type: Sequelize.ENUM("inbound", "outbound"),
      allowNull: true,
    });
    await add("userId", { type: Sequelize.INTEGER, allowNull: true });
    await add("ticketId", { type: Sequelize.INTEGER, allowNull: true });
    await add("QuestionsAnswers", { type: Sequelize.JSON, allowNull: true });
    await add("languages", { type: Sequelize.JSON, allowNull: true });
    await add("isResolvedByAi", { type: Sequelize.BOOLEAN, allowNull: true });
    await add("summary", { type: Sequelize.TEXT, allowNull: true }); // TEXT can't have DB default in MySQL
    await add("recordingUrl", { type: Sequelize.STRING, allowNull: true });
    await add("callSid", { type: Sequelize.STRING, allowNull: true });
    await add("outboundDetails", { type: Sequelize.JSON, allowNull: true });

    await add("createdAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
    await add("updatedAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    // ✅ Backfill NULL summaries to empty string (ANSI_QUOTES-safe)
    await queryInterface.bulkUpdate(
      "calls",
      { summary: "" },
      { summary: null }
    );
  },

  async down(queryInterface /*, Sequelize */) {
    const table = await queryInterface.describeTable("calls");
    const remove = (name) =>
      table[name]
        ? queryInterface.removeColumn("calls", name)
        : Promise.resolve();

    await remove("outboundDetails");
    await remove("callSid");
    await remove("recordingUrl");
    await remove("summary");
    await remove("isResolvedByAi");
    await remove("languages");
    await remove("QuestionsAnswers");
    await remove("ticketId");
    await remove("userId");
    await remove("updatedAt");
    await remove("createdAt");
    await remove("type");
  },
};
