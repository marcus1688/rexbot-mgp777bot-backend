const express = require("express");
const router = express.Router();
const DailySummary = require("../models/dailySummary.model");
const SummaryService = require("../services/summaryService");
const GlobalConfig = require("../models/globalConfig.model");
const RiskControl = require("../models/riskControl.model");
const moment = require("moment-timezone");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const verifyPassword = (req, res, next) => {
  const password = req.headers["admin-password"];
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "密码错误" });
  }
  next();
};

const getTodayString = () => {
  const now = moment().tz("Asia/Kuala_Lumpur");
  if (now.hour() < 6) {
    return now.subtract(1, "day").format("YYYY-MM-DD");
  }
  return now.format("YYYY-MM-DD");
};

const getBusinessDayRange = (dateStr) => {
  const start = moment
    .tz(dateStr, "Asia/Kuala_Lumpur")
    .hour(6)
    .minute(0)
    .second(0)
    .millisecond(0)
    .utc()
    .toDate();

  const end = moment
    .tz(dateStr, "Asia/Kuala_Lumpur")
    .add(1, "day")
    .hour(5)
    .minute(59)
    .second(59)
    .millisecond(999)
    .utc()
    .toDate();

  return { start, end };
};

router.get("/api/admin/dashboard", verifyPassword, async (req, res) => {
  try {
    const { startDate, endDate, date } = req.query;
    let query = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (date) {
      query.date = date;
    } else {
      query.date = getTodayString();
    }
    const summaries = await DailySummary.find(query);
    const totals = summaries.reduce(
      (acc, s) => ({
        totalIncoming: acc.totalIncoming + s.incomingAmount,
        totalIncomingUsdt: acc.totalIncomingUsdt + s.actualIncomingUsdt,
        totalOutgoing: acc.totalOutgoing + s.outgoingUsdt,
        totalPending: acc.totalPending + s.pendingUsdt,
        walletBalance: acc.walletBalance + s.walletBalance,
        netProfit: acc.netProfit + s.netProfit,
      }),
      {
        totalIncoming: 0,
        totalIncomingUsdt: 0,
        totalOutgoing: 0,
        totalPending: 0,
        walletBalance: 0,
        netProfit: 0,
      }
    );
    const groupStats = summaries.map((s) => ({
      chatId: s.chatId,
      groupName: s.groupName || "Unknown",
      totalIncoming: s.incomingAmount,
      totalPending: s.pendingUsdt,
      totalOutgoing: s.outgoingUsdt,
      date: s.date,
    }));
    res.json({
      date: query.date,
      totals: {
        当日总入款: totals.totalIncoming,
        walletBalance: totals.walletBalance,
        回U: totals.totalPending,
        净赚: totals.netProfit,
      },
      groups: groupStats,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post(
  "/api/admin/rebuild-summaries",
  verifyPassword,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.body;
      if (!startDate) {
        return res.status(400).json({ error: "需要提供开始日期" });
      }
      await SummaryService.rebuildSummaries(startDate, endDate || startDate);
      res.json({
        message: "汇总数据重建成功",
        dateRange: { startDate, endDate: endDate || startDate },
      });
    } catch (error) {
      console.error("Rebuild error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.get("/api/admin/summaries", verifyPassword, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "请提供开始日期和结束日期",
      });
    }
    const summaries = await DailySummary.find({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).sort({ date: 1 });
    res.json({
      success: true,
      data: summaries,
      dateRange: {
        startDate,
        endDate,
      },
    });
  } catch (error) {
    console.error("获取汇总数据失败:", error);
    res.status(500).json({
      error: "获取汇总数据失败",
      message: error.message,
    });
  }
});

router.put("/api/admin/buyrate", verifyPassword, async (req, res) => {
  try {
    const { buyRate } = req.body;
    if (!buyRate || buyRate <= 0) {
      return res.status(400).json({
        error: "请提供有效的 buyRate",
      });
    }
    const result = await GlobalConfig.findOneAndUpdate(
      { key: "buyRate" },
      {
        value: buyRate,
        updatedAt: new Date(),
      },
      {
        new: true,
        upsert: true,
      }
    );
    res.json({
      success: true,
      data: {
        key: "buyRate",
        value: result.value,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    console.error("更新 buyRate 失败:", error);
    res.status(500).json({
      error: "更新 buyRate 失败",
      message: error.message,
    });
  }
});

router.get("/api/admin/buyrate", verifyPassword, async (req, res) => {
  try {
    const config = await GlobalConfig.findOne({ key: "buyRate" });
    const buyRate = config ? config.value : 16300;
    res.json({
      success: true,
      data: {
        buyRate: buyRate,
        updatedAt: config?.updatedAt,
      },
    });
  } catch (error) {
    console.error("获取 buyRate 失败:", error);
    res.status(500).json({
      error: "获取 buyRate 失败",
      message: error.message,
    });
  }
});

router.post("/api/admin/risk-control", verifyPassword, async (req, res) => {
  try {
    const { amount, remark } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "请提供有效的金额" });
    }
    if (!remark) {
      return res.status(400).json({ error: "请提供备注" });
    }
    const riskControl = new RiskControl({
      amount,
      remark,
    });
    await riskControl.save();
    res.json({
      success: true,
      data: riskControl,
    });
  } catch (error) {
    console.error("创建风控记录失败:", error);
    res.status(500).json({ error: "创建风控记录失败" });
  }
});

router.get("/api/admin/risk-control", verifyPassword, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    if (startDate && endDate) {
      const { start } = getBusinessDayRange(startDate);
      const { end } = getBusinessDayRange(endDate);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    }
    const records = await RiskControl.find(query).sort({ timestamp: -1 });
    res.json({
      success: true,
      data: records,
    });
  } catch (error) {
    console.error("获取风控记录失败:", error);
    res.status(500).json({ error: "获取风控记录失败" });
  }
});

router.delete(
  "/api/admin/risk-control/:id",
  verifyPassword,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "请提供记录ID" });
      }
      const record = await RiskControl.findByIdAndDelete(id);

      if (!record) {
        return res.status(404).json({ error: "记录不存在" });
      }
      res.json({
        success: true,
        message: "删除成功",
        data: record,
      });
    } catch (error) {
      console.error("删除风控记录失败:", error);
      res.status(500).json({ error: "删除失败" });
    }
  }
);

module.exports = router;
