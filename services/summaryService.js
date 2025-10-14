const DailySummary = require("../models/dailySummary.model");
const Transaction = require("../models/transaction.model");
const Config = require("../models/config.model");
const GlobalConfig = require("../models/globalConfig.model");
const moment = require("moment-timezone");

class SummaryService {
  static async getBuyRate() {
    const config = await GlobalConfig.findOne({ key: "buyRate" });
    return config ? config.value : 16300;
  }
  static async getSellRate() {
    const config = await GlobalConfig.findOne({ key: "sellRate" });
    return config ? config.value : 0;
  }
  static getBusinessDayRange(dateStr) {
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
  }

  static async updateSummaryOnTransaction(transaction, config) {
    const date = transaction.date;
    const chatId = transaction.chatId;

    let summary = await DailySummary.findOne({ date });

    if (!summary) {
      summary = new DailySummary({
        date,
        groups: [],
        totals: {},
      });
    }

    let groupIndex = summary.groups.findIndex((g) => g.chatId === chatId);
    if (groupIndex === -1) {
      summary.groups.push({
        chatId,
        groupName: transaction.groupName,
      });
      groupIndex = summary.groups.length - 1;
    } else {
      if (summary.groups[groupIndex].groupName !== transaction.groupName) {
        summary.groups[groupIndex].groupName = transaction.groupName;
      }
    }
    const group = summary.groups[groupIndex];

    switch (transaction.type) {
      case "入款":
        const feeRate =
          transaction.feeRate !== undefined
            ? transaction.feeRate
            : config.feeRate;
        const incomingUsdt = transaction.amount / transaction.rate;
        const actualUsdt = incomingUsdt * (1 - feeRate / 100);

        const sellRate = await SummaryService.getSellRate();
        const sellUsdt = sellRate > 0 ? transaction.amount / sellRate : 0;
        const sellProfit = sellRate > 0 ? sellUsdt - incomingUsdt : 0;

        group.incomingCount += 1;
        group.incomingAmount += transaction.amount;
        group.incomingUsdt += incomingUsdt;
        group.actualIncomingUsdt += actualUsdt;
        group.sellUsdt += sellUsdt;
        group.sellProfit += sellProfit;

        summary.totals.incomingCount += 1;
        summary.totals.incomingAmount += transaction.amount;
        summary.totals.incomingUsdt += incomingUsdt;
        summary.totals.actualIncomingUsdt += actualUsdt;
        summary.totals.sellUsdt += sellUsdt;
        summary.totals.sellProfit += sellProfit;
        break;

      case "下发":
        group.outgoingCount += 1;
        group.outgoingUsdt += transaction.usdt;

        summary.totals.outgoingCount += 1;
        summary.totals.outgoingUsdt += transaction.usdt;
        break;

      case "代付":
        const handlingFee = config.handlingFee || 0;
        const buyRate = await SummaryService.getBuyRate();
        const outRate = transaction.rate || config.outRate || 16000;

        const costUsdt = transaction.amount / buyRate + handlingFee;
        const commission = transaction.usdt - costUsdt;

        group.payoutCount += 1;
        group.payoutAmount += transaction.amount;
        group.payoutFees += handlingFee;
        group.payoutUsdt += transaction.usdt;
        group.payoutCommission += commission;

        summary.totals.payoutCount += 1;
        summary.totals.payoutAmount += transaction.amount;
        summary.totals.payoutFees += handlingFee;
        summary.totals.payoutUsdt += transaction.usdt;
        summary.totals.payoutCommission += commission;
        break;
    }

    group.shouldIssued =
      (group.actualIncomingUsdt || 0) - (group.payoutUsdt || 0);
    group.pendingUsdt = (group.shouldIssued || 0) - (group.outgoingUsdt || 0);
    group.wallet =
      (group.incomingUsdt || 0) -
      (group.outgoingUsdt || 0) -
      (group.payoutUsdt || 0) +
      (group.payoutCommission || 0) +
      (group.payoutFees || 0);
    group.profit =
      (group.incomingUsdt || 0) -
      (group.actualIncomingUsdt || 0) +
      (group.payoutFees || 0) +
      (group.payoutCommission || 0);

    summary.totals.shouldIssued =
      (summary.totals.actualIncomingUsdt || 0) -
      (summary.totals.payoutUsdt || 0);
    summary.totals.pendingUsdt =
      (summary.totals.shouldIssued || 0) - (summary.totals.outgoingUsdt || 0);
    summary.totals.wallet =
      (summary.totals.incomingUsdt || 0) -
      (summary.totals.outgoingUsdt || 0) -
      (summary.totals.payoutUsdt || 0) +
      (summary.totals.payoutCommission || 0) +
      (summary.totals.payoutFees || 0);
    summary.totals.profit =
      (summary.totals.incomingUsdt || 0) -
      (summary.totals.actualIncomingUsdt || 0) +
      (summary.totals.payoutFees || 0) +
      (summary.totals.payoutCommission || 0);

    summary.lastUpdated = new Date();
    await summary.save();
    return summary;
  }

  static async getDailySummary(date) {
    return await DailySummary.findOne({ date });
  }

  static async getGroupSummary(date, chatId) {
    const summary = await DailySummary.findOne(
      { date, "groups.chatId": chatId },
      { "groups.$": 1 }
    );
    return summary?.groups[0] || null;
  }

  static async reverseTransaction(transaction, config) {
    const date = transaction.date;
    const chatId = transaction.chatId;

    let summary = await DailySummary.findOne({ date });
    if (!summary) {
      console.error(`找不到汇总记录: date=${date}`);
      return null;
    }

    const groupIndex = summary.groups.findIndex((g) => g.chatId === chatId);
    if (groupIndex === -1) {
      console.error(`找不到群组记录: chatId=${chatId}`);
      return null;
    }

    if (summary.groups[groupIndex].groupName !== transaction.groupName) {
      summary.groups[groupIndex].groupName = transaction.groupName;
    }

    const group = summary.groups[groupIndex];

    switch (transaction.type) {
      case "入款":
        const feeRate =
          transaction.feeRate !== undefined
            ? transaction.feeRate
            : config.feeRate;
        const incomingUsdt = transaction.amount / transaction.rate;
        const actualUsdt = incomingUsdt * (1 - feeRate / 100);
        const sellRate = await SummaryService.getSellRate();
        const sellUsdt = sellRate > 0 ? transaction.amount / sellRate : 0;
        const sellProfit = sellRate > 0 ? sellUsdt - incomingUsdt : 0;

        group.incomingCount -= 1;
        group.incomingAmount -= transaction.amount;
        group.incomingUsdt -= incomingUsdt;
        group.actualIncomingUsdt -= actualUsdt;
        group.sellUsdt -= sellUsdt;
        group.sellProfit -= sellProfit;

        summary.totals.incomingCount -= 1;
        summary.totals.incomingAmount -= transaction.amount;
        summary.totals.incomingUsdt -= incomingUsdt;
        summary.totals.actualIncomingUsdt -= actualUsdt;
        summary.totals.sellUsdt -= sellUsdt;
        summary.totals.sellProfit -= sellProfit;
        break;

      case "下发":
        group.outgoingCount -= 1;
        group.outgoingUsdt -= transaction.usdt;

        summary.totals.outgoingCount -= 1;
        summary.totals.outgoingUsdt -= transaction.usdt;
        break;

      case "代付":
        const handlingFee = config.handlingFee || 0;
        const buyRate = await SummaryService.getBuyRate();
        const outRate = transaction.rate || config.outRate || 16000;

        const costUsdt = transaction.amount / buyRate + handlingFee;
        const commission = transaction.usdt - costUsdt;

        group.payoutCount -= 1;
        group.payoutAmount -= transaction.amount;
        group.payoutFees -= handlingFee;
        group.payoutUsdt -= transaction.usdt;
        group.payoutCommission -= commission;

        summary.totals.payoutCount -= 1;
        summary.totals.payoutAmount -= transaction.amount;
        summary.totals.payoutFees -= handlingFee;
        summary.totals.payoutUsdt -= transaction.usdt;
        summary.totals.payoutCommission -= commission;
        break;
    }

    group.shouldIssued =
      (group.actualIncomingUsdt || 0) - (group.payoutUsdt || 0);
    group.pendingUsdt = (group.shouldIssued || 0) - (group.outgoingUsdt || 0);
    group.wallet =
      (group.incomingUsdt || 0) -
      (group.outgoingUsdt || 0) -
      (group.payoutUsdt || 0) +
      (group.payoutCommission || 0) +
      (group.payoutFees || 0);
    group.profit =
      (group.incomingUsdt || 0) -
      (group.actualIncomingUsdt || 0) +
      (group.payoutFees || 0) +
      (group.payoutCommission || 0);

    summary.totals.shouldIssued =
      (summary.totals.actualIncomingUsdt || 0) -
      (summary.totals.payoutUsdt || 0);
    summary.totals.pendingUsdt =
      (summary.totals.shouldIssued || 0) - (summary.totals.outgoingUsdt || 0);
    summary.totals.wallet =
      (summary.totals.incomingUsdt || 0) -
      (summary.totals.outgoingUsdt || 0) -
      (summary.totals.payoutUsdt || 0) +
      (summary.totals.payoutCommission || 0) +
      (summary.totals.payoutFees || 0);
    summary.totals.profit =
      (summary.totals.incomingUsdt || 0) -
      (summary.totals.actualIncomingUsdt || 0) +
      (summary.totals.payoutFees || 0) +
      (summary.totals.payoutCommission || 0);

    summary.lastUpdated = new Date();
    await summary.save();
    return summary;
  }

  static async rebuildSummaries(startDate, endDate = null) {
    if (!endDate) {
      endDate = startDate;
    }

    console.log(`开始重建汇总数据: ${startDate} 到 ${endDate}`);

    await DailySummary.deleteMany({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    });

    const start = moment(startDate).format("YYYY-MM-DD");
    const end = moment(endDate).format("YYYY-MM-DD");
    const dates = [];
    let current = moment(start);

    while (current.isSameOrBefore(end)) {
      dates.push(current.format("YYYY-MM-DD"));
      current.add(1, "day");
    }

    for (const date of dates) {
      const { start: dayStart, end: dayEnd } = this.getBusinessDayRange(date);

      const transactions = await Transaction.find({
        timestamp: {
          $gte: dayStart,
          $lte: dayEnd,
        },
      });

      if (transactions.length === 0) continue;

      const summary = new DailySummary({
        date,
        groups: [],
        totals: {},
      });

      const groupedTransactions = {};
      transactions.forEach((t) => {
        if (!groupedTransactions[t.chatId]) {
          groupedTransactions[t.chatId] = [];
        }
        groupedTransactions[t.chatId].push(t);
      });

      for (const [chatId, groupTransactions] of Object.entries(
        groupedTransactions
      )) {
        const config = await Config.findOne({ chatId });

        const group = {
          chatId,
          groupName: groupTransactions[0]?.groupName || "Unknown",
          incomingCount: 0,
          incomingAmount: 0,
          incomingUsdt: 0,
          actualIncomingUsdt: 0,
          sellUsdt: 0,
          sellProfit: 0,
          outgoingCount: 0,
          outgoingUsdt: 0,
          payoutCount: 0,
          payoutAmount: 0,
          payoutFees: 0,
          payoutUsdt: 0,
          payoutCommission: 0,
          shouldIssued: 0,
          pendingUsdt: 0,
          wallet: 0,
          profit: 0,
        };

        for (const transaction of groupTransactions) {
          switch (transaction.type) {
            case "入款":
              const amount = parseFloat(transaction.amount) || 0;
              const rate = parseFloat(transaction.rate) || 16500;
              const feeRate =
                transaction.feeRate !== undefined
                  ? parseFloat(transaction.feeRate)
                  : config?.feeRate !== undefined
                  ? parseFloat(config.feeRate)
                  : 2;

              const incomingUsdt = amount / rate;
              const actualUsdt = incomingUsdt * (1 - feeRate / 100);
              const sellRate = await SummaryService.getSellRate();
              const sellUsdt = sellRate > 0 ? amount / sellRate : 0;
              const sellProfit = sellRate > 0 ? sellUsdt - incomingUsdt : 0;

              group.incomingCount += 1;
              group.incomingAmount += amount;
              group.incomingUsdt += incomingUsdt;
              group.actualIncomingUsdt += actualUsdt;
              group.sellUsdt += sellUsdt;
              group.sellProfit += sellProfit;

              summary.totals.incomingCount += 1;
              summary.totals.incomingAmount += amount;
              summary.totals.incomingUsdt += incomingUsdt;
              summary.totals.actualIncomingUsdt += actualUsdt;
              summary.totals.sellUsdt += sellUsdt;
              summary.totals.sellProfit += sellProfit;
              break;

            case "下发":
              const outgoingUsdt = parseFloat(transaction.usdt) || 0;
              group.outgoingCount += 1;
              group.outgoingUsdt += outgoingUsdt;

              summary.totals.outgoingCount += 1;
              summary.totals.outgoingUsdt += outgoingUsdt;
              break;

            case "代付":
              const payoutAmount = parseFloat(transaction.amount) || 0;
              const payoutUsdt = parseFloat(transaction.usdt) || 0;
              const handlingFee = config?.handlingFee || 0;
              const buyRate = await SummaryService.getBuyRate();
              const outRate =
                parseFloat(transaction.rate) || config?.outRate || 16000;

              const costUsdt = payoutAmount / buyRate + handlingFee;
              const commission = payoutUsdt - costUsdt;

              group.payoutCount += 1;
              group.payoutAmount += payoutAmount;
              group.payoutFees += handlingFee;
              group.payoutUsdt += payoutUsdt;
              group.payoutCommission += commission;

              summary.totals.payoutCount += 1;
              summary.totals.payoutAmount += payoutAmount;
              summary.totals.payoutFees += handlingFee;
              summary.totals.payoutUsdt += payoutUsdt;
              summary.totals.payoutCommission += commission;
              break;
          }
        }

        group.shouldIssued =
          (group.actualIncomingUsdt || 0) - (group.payoutUsdt || 0);
        group.pendingUsdt =
          (group.shouldIssued || 0) - (group.outgoingUsdt || 0);
        group.wallet =
          (group.incomingUsdt || 0) -
          (group.outgoingUsdt || 0) -
          (group.payoutUsdt || 0) +
          (group.payoutCommission || 0) +
          (group.payoutFees || 0);
        group.profit =
          (group.incomingUsdt || 0) -
          (group.actualIncomingUsdt || 0) +
          (group.payoutFees || 0) +
          (group.payoutCommission || 0);

        summary.groups.push(group);
      }

      summary.totals.shouldIssued =
        (summary.totals.actualIncomingUsdt || 0) -
        (summary.totals.payoutUsdt || 0);
      summary.totals.pendingUsdt =
        (summary.totals.shouldIssued || 0) - (summary.totals.outgoingUsdt || 0);
      summary.totals.wallet =
        (summary.totals.incomingUsdt || 0) -
        (summary.totals.outgoingUsdt || 0) -
        (summary.totals.payoutUsdt || 0) +
        (summary.totals.payoutCommission || 0) +
        (summary.totals.payoutFees || 0);
      summary.totals.profit =
        (summary.totals.incomingUsdt || 0) -
        (summary.totals.actualIncomingUsdt || 0) +
        (summary.totals.payoutFees || 0) +
        (summary.totals.payoutCommission || 0);

      summary.lastUpdated = new Date();
      await summary.save();
    }

    console.log(`汇总数据重建完成: ${startDate} 到 ${endDate}`);
  }
}

module.exports = SummaryService;
