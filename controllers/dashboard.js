import { Op, fn, col, literal } from "sequelize";
import { User, Ticket, Rating, Call, Agent } from "../models/index.js";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const TZ = "Asia/Karachi";
const KARACHI_OFFSET = "+05:00";

const dayUtc = (d) => ({
  start: fromZonedTime(startOfDay(d), TZ),
  end: fromZonedTime(endOfDay(d), TZ),
});
const rangeDaysUtc = (days) => {
  const now = new Date();
  const s = startOfDay(subDays(now, days - 1));
  const e = endOfDay(now);
  return { start: fromZonedTime(s, TZ), end: fromZonedTime(e, TZ) };
};
const fillDates = (days) => {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(now, i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }
  return out;
};

export const dashboardLite = async (req, res) => {
  try {
    const role = String(req.query.role || "admin").toLowerCase();
    const agentId = req.query.agentId ? parseInt(req.query.agentId, 10) : null;
    const topN = Math.min(Math.max(parseInt(req.query.top || "5", 10), 1), 50);

    if (role !== "admin" && (!agentId || Number.isNaN(agentId)))
      return res
        .status(400)
        .json({ error: "agentId required for non-admin role" });

    const todayB = dayUtc(new Date());
    const last7 = rangeDaysUtc(7);

    let ticketIds = [];
    let userIds = [];

    if (role !== "admin") {
      const tickets = await Ticket.findAll({
        attributes: ["id", "userId"],
        where: { agentId },
        raw: true,
      });
      ticketIds = tickets.map((t) => t.id);
      userIds = tickets.map((t) => t.userId).filter(Boolean);
      if (ticketIds.length) {
        const callUsers = await Call.findAll({
          attributes: [[fn("DISTINCT", col("userId")), "userId"]],
          where: { ticketId: { [Op.in]: ticketIds } },
          raw: true,
        });
        userIds.push(...callUsers.map((r) => r.userId).filter(Boolean));
        userIds = Array.from(new Set(userIds));
      }
    }

    const userWhere =
      role === "admin"
        ? {}
        : userIds.length
        ? { id: { [Op.in]: userIds } }
        : { id: { [Op.eq]: null } };
    const ticketWhere = role === "admin" ? {} : { agentId };
    const callWhereBase =
      role === "admin"
        ? {}
        : ticketIds.length || userIds.length
        ? {
            [Op.or]: [
              ticketIds.length ? { ticketId: { [Op.in]: ticketIds } } : null,
              userIds.length ? { userId: { [Op.in]: userIds } } : null,
            ].filter(Boolean),
          }
        : { id: { [Op.eq]: null } };

    const [
      totalUsers,
      usersToday,
      totalTickets,
      ticketsToday,
      totalInbound,
      totalOutbound,
      callsToday,
      inboundToday,
      outboundToday,
    ] = await Promise.all([
      User.count({ where: userWhere }),
      User.count({
        where: {
          ...userWhere,
          createdAt: { [Op.between]: [todayB.start, todayB.end] },
        },
      }),
      Ticket.count({ where: ticketWhere }),
      Ticket.count({
        where: {
          ...ticketWhere,
          createdAt: { [Op.between]: [todayB.start, todayB.end] },
        },
      }),
      Call.count({ where: { ...callWhereBase, type: "inbound" } }),
      Call.count({ where: { ...callWhereBase, type: "outbound" } }),
      Call.count({
        where: {
          ...callWhereBase,
          createdAt: { [Op.between]: [todayB.start, todayB.end] },
        },
      }),
      Call.count({
        where: {
          ...callWhereBase,
          type: "inbound",
          createdAt: { [Op.between]: [todayB.start, todayB.end] },
        },
      }),
      Call.count({
        where: {
          ...callWhereBase,
          type: "outbound",
          createdAt: { [Op.between]: [todayB.start, todayB.end] },
        },
      }),
    ]);

    const dayExpr = literal(
      `DATE(CONVERT_TZ(createdAt, '+00:00', '${KARACHI_OFFSET}'))`
    );
    const callTS = await Call.findAll({
      attributes: [[dayExpr, "d"], "type", [fn("COUNT", col("id")), "count"]],
      where: {
        ...callWhereBase,
        createdAt: { [Op.between]: [last7.start, last7.end] },
      },
      group: ["d", "type"],
      order: [[literal("d"), "ASC"]],
      raw: true,
    });

    const dates = fillDates(7);
    const base = Object.fromEntries(
      dates.map((d) => [d, { inbound: 0, outbound: 0, total: 0 }])
    );
    callTS.forEach((r) => {
      if (!base[r.d]) return;
      if (r.type === "inbound") base[r.d].inbound = Number(r.count);
      else base[r.d].outbound = Number(r.count);
      base[r.d].total = base[r.d].inbound + base[r.d].outbound;
    });
    const timeseries7d = dates.map((d) => ({ date: d, ...base[d] }));

    let topAgents = [];
    if (role === "admin") {
      const top = await Rating.findAll({
        attributes: [
          "agentId",
          [fn("AVG", col("score")), "avg"],
          [fn("COUNT", col("Rating.id")), "count"],
        ],
        include: [
          {
            model: Agent,
            attributes: ["id", "firstName", "lastName", "email"],
          },
        ],
        group: ["agentId", "Agent.id"],
        order: [[literal("avg"), "DESC"]],
        limit: topN,
        raw: true,
      });
      topAgents = top.map((r) => ({
        agentId: r.agentId,
        name: `${r["Agent.firstName"]} ${r["Agent.lastName"]}`,
        email: r["Agent.email"],
        avg: Number(Number(r.avg).toFixed(2)),
        count: Number(r.count),
      }));
    } else {
      const self = await Rating.findAll({
        attributes: [
          [fn("AVG", col("score")), "avg"],
          [fn("COUNT", col("Rating.id")), "count"],
        ],
        where: { agentId },
        raw: true,
      });
      const agent = await Agent.findByPk(agentId, {
        attributes: ["id", "firstName", "lastName", "email"],
        raw: true,
      });
      const r = self?.[0] || { avg: 0, count: 0 };
      if (agent)
        topAgents = [
          {
            agentId: agent.id,
            name: `${agent.firstName} ${agent.lastName}`,
            email: agent.email,
            avg: Number(Number(r.avg).toFixed(2)),
            count: Number(r.count),
          },
        ];
    }

    res.json({
      scope: role === "admin" ? { role } : { role, agentId },
      summary: {
        users: { total: totalUsers, today: usersToday },
        tickets: { total: totalTickets, today: ticketsToday },
        calls: {
          total: totalInbound + totalOutbound,
          today: callsToday,
          inbound: { total: totalInbound, today: inboundToday },
          outbound: { total: totalOutbound, today: outboundToday },
        },
      },
      topAgents,
      timeseries7d,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
