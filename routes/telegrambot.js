const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const router = express.Router();
const Config = require("../models/config.model");
const Transaction = require("../models/transaction.model");
const DailyReport = require("../models/report.model");
const moment = require("moment-timezone");
const SummaryService = require("../services/summaryService");

let bot = null;
const deleteConfirmations = new Map();

const initializeBot = async () => {
  if (bot) {
    console.log("停止现有的 Bot 实例...");
    if (process.env.NODE_ENV !== "production") {
      bot.stopPolling();
    }
    bot = null;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error("请在 .env 文件中设置 TELEGRAM_BOT_TOKEN");
    return null;
  }
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    bot = new TelegramBot(token);
    const webhookUrl = `https://mgp777bot.luckybot7.com/webhook/${token}`;
    await bot.setWebHook(webhookUrl);
    console.log("📱 Telegram机器人已启动 (Webhook 模式)");
    console.log("Webhook URL:", webhookUrl);
  } else {
    bot = new TelegramBot(token, { polling: true });
    console.log("📱 Telegram机器人已启动 (Polling 模式)");
  }

  setupBotHandlers();
  return bot;
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

const formatTime = (date = new Date()) => {
  return moment(date).tz("Asia/Kuala_Lumpur").format("HH:mm:ss");
};

const deleteTodayTransactions = async (chatId) => {
  const today = getTodayString();
  const { start, end } = getBusinessDayRange(today);

  const result = await Transaction.deleteMany({
    chatId: chatId.toString(),
    timestamp: {
      $gte: start,
      $lte: end,
    },
  });

  return result;
};

const formatNumber = (num) => {
  return num.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

const getConfig = async (chatId) => {
  let config = await Config.findOne({ chatId: chatId.toString() });
  if (!config) {
    config = new Config({ chatId: chatId.toString() });
    await config.save();
  }
  return config;
};

const getTodayTransactions = async (chatId) => {
  const today = getTodayString();
  const { start, end } = getBusinessDayRange(today);
  return await Transaction.find({
    chatId: chatId.toString(),
    timestamp: {
      $gte: start,
      $lte: end,
    },
  }).sort({ timestamp: 1 });
};

const calculateStats = (transactions, currentFeeRate) => {
  const 入款 = transactions.filter((t) => t.type === "入款");
  const 下发 = transactions.filter((t) => t.type === "下发");
  const 代付 = transactions.filter((t) => t.type === "代付");
  const totalInAmount = 入款.reduce((sum, t) => sum + t.amount, 0);
  const totalInUsdt = 入款.reduce((sum, t) => sum + t.amount / t.rate, 0);
  const totalOutUsdt = 下发.reduce((sum, t) => sum + t.usdt, 0);
  const totalActualUsdt = 入款.reduce((sum, t) => {
    const feeRate = t.feeRate !== undefined ? t.feeRate : currentFeeRate;
    return sum + (t.amount / t.rate) * (1 - feeRate / 100);
  }, 0);
  const totalPayoutUsdt = 代付.reduce((sum, t) => sum + t.usdt, 0);
  const totalPayoutAmount = 代付.reduce((sum, t) => sum + t.amount, 0);
  const adjustedActualUsdt = totalActualUsdt - totalPayoutUsdt;
  return {
    入款,
    下发,
    代付,
    totalInAmount,
    totalInUsdt,
    totalOutUsdt,
    totalActualUsdt,
    totalPayoutUsdt,
    totalPayoutAmount,
    adjustedActualUsdt,
  };
};

const generateTelegramLink = (chatId, messageId) => {
  const chatIdStr = chatId.toString();
  if (chatIdStr.startsWith("-100")) {
    const groupId = chatIdStr.slice(4);
    return `https://t.me/c/${groupId}/${messageId}`;
  } else {
    const groupId = Math.abs(parseInt(chatId));
    return `https://t.me/c/${groupId}/${messageId}`;
  }
};

const formatReport = async (chatId, newTransactionId = null) => {
  try {
    const config = await getConfig(chatId);
    const transactions = await getTodayTransactions(chatId);
    const stats = calculateStats(transactions, config.feeRate);
    const 入款显示 = stats.入款.slice(-10);
    const 代付显示 = stats.代付.slice(-10);
    const 下发显示 = stats.下发.slice(-10);
    let report = `今日入款（${stats.入款.length}笔）\n`;
    if (stats.入款.length === 0) {
      report += `暂无入款记录\n`;
    } else {
      if (stats.入款.length > 10) {
        report += `*显示最新10笔，共${stats.入款.length}笔*\n`;
      }
      入款显示.forEach((t) => {
        const time = formatTime(t.timestamp);
        const feeRate = t.feeRate !== undefined ? t.feeRate : config.feeRate;
        const actualUsdt = (t.amount / t.rate) * (1 - feeRate / 100);
        const feeAmount = (t.amount * feeRate) / 100;
        const idLink = t.messageId ? `<code>${t.messageId}</code>` : `ID`;

        if (newTransactionId && t._id.toString() === newTransactionId) {
          report += `${t.messageId} ${time}  ${formatNumber(t.amount)} / ${
            t.rate
          } * (${(1 - feeRate / 100)
            .toFixed(4)
            .replace(/\.?0+$/, "")})=${actualUsdt.toFixed(
            2
          )}U 手续(${formatNumber(feeAmount)})\n`;
        } else {
          const amountLink = t.messageId
            ? `<a href="${generateTelegramLink(
                chatId,
                t.messageId
              )}">${formatNumber(t.amount)}</a>`
            : `${formatNumber(t.amount)}`;
          let identifier = "";
          if (t.remark) {
            identifier = `(${t.remark})`;
          } else if (t.displayName) {
            identifier = t.username
              ? `<a href="https://t.me/${t.username}">${t.displayName}</a>`
              : t.displayName;
          }
          report += `${idLink} ${time}  ${amountLink} / ${t.rate} * (${(
            1 -
            feeRate / 100
          )
            .toFixed(4)
            .replace(/\.?0+$/, "")})=${actualUsdt.toFixed(2)}U ${identifier}\n`;
        }
      });
    }

    report += `\n今日代付（${stats.代付.length}笔）\n`;

    if (stats.代付.length === 0) {
      report += `暂无代付记录\n`;
    } else {
      if (stats.代付.length > 10) {
        report += `*显示最新10笔，共${stats.代付.length}笔*\n`;
      }
      代付显示.forEach((t) => {
        const time = formatTime(t.timestamp);
        const idLink = t.messageId ? `<code>${t.messageId}</code>` : `ID`;
        const amountLink = t.messageId
          ? `<a href="${generateTelegramLink(
              chatId,
              t.messageId
            )}">${formatNumber(t.amount)}</a>`
          : `${formatNumber(t.amount)}`;

        let identifier = "";
        if (t.remark) {
          identifier = `(${t.remark})`;
        } else if (t.displayName) {
          identifier = t.username
            ? `<a href="https://t.me/${t.username}">${t.displayName}</a>`
            : t.displayName;
        }

        report += `${idLink} ${time}  ${amountLink}/${t.rate}+${
          config.handlingFee
        }U=${t.usdt.toFixed(2)}U ${identifier}\n`;
      });
      report += `\n代付总额：${formatNumber(stats.totalPayoutAmount)}\n`;
    }

    report += `\n今日下发（${stats.下发.length}笔）\n`;
    if (stats.下发.length === 0) {
      report += `暂无下发记录\n`;
    } else {
      if (stats.下发.length > 10) {
        report += `*显示最新10笔，共${stats.下发.length}笔*\n`;
      }
      下发显示.forEach((t) => {
        const time = formatTime(t.timestamp);
        const idLink = t.messageId ? `<code>${t.messageId}</code>` : `ID`;
        const usdtLink = t.messageId
          ? `<a href="${generateTelegramLink(chatId, t.messageId)}">${
              t.usdt
            }U</a>`
          : `${t.usdt}U`;
        let identifier = "";
        if (t.remark) {
          identifier = `(${t.remark})`;
        } else if (t.displayName) {
          identifier = t.username
            ? `<a href="https://t.me/${t.username}">${t.displayName}</a>`
            : t.displayName;
        }

        report += `${idLink} ${time}  ${usdtLink} ${identifier}\n`;
      });
    }

    report += `\n总入款：${formatNumber(
      stats.totalInAmount
    )} (${stats.totalInUsdt.toFixed(2)}U)\n`;
    report += `当前费率：${config.feeRate}%\n`;
    report += `汇率：${config.inRate}\n`;
    report += `代付单笔手续费：${config.handlingFee}\n`;
    report += `下发汇率：${config.outRate}\n`;

    const adjustedActualUsdt = Math.floor(stats.adjustedActualUsdt * 100) / 100;
    report += `\n应下发：${adjustedActualUsdt.toFixed(2)}U\n`;

    const outUsdt = Math.floor(stats.totalOutUsdt * 100) / 100;
    report += `已下发：${outUsdt.toFixed(2)}U\n`;

    const unDispensed =
      Math.floor((stats.adjustedActualUsdt - stats.totalOutUsdt) * 100) / 100;
    report += `未下发：${unDispensed.toFixed(2)}U`;

    return report;
  } catch (error) {
    console.error("格式化报告错误:", error);
    return "生成报告时出现错误";
  }
};

const sendReportWithButton = (chatId, report) => {
  const urlSafeChatId = Math.abs(parseInt(chatId));
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🌍完整账单",
          url: `https://luckybot7.com/report/${urlSafeChatId}?bot=mgp777`,
        },
      ],
    ],
  };
  return bot.sendMessage(chatId, report, {
    parse_mode: "HTML",
    reply_markup: keyboard,
    disable_web_page_preview: true,
  });
};

const OWNER_IDS = [
  5342992954, 7901434688, 7849481867, 6900459191, 7668035205, 7739890736,
  8383250846, 2129732648, 786344763,
];

// const checkPermission = async (chatId, userId) => {
//   try {
//     const config = await getConfig(chatId);
//     const user = await bot.getChatMember(chatId, userId);
//     console.log(user);
//     return (
//       OWNER_IDS.includes(userId) ||
//       config.operators.includes(user.user.username)
//     );
//   } catch (error) {
//     console.error("权限检查错误:", error);
//     return false;
//   }
// };

const checkPermission = async (chatId, userId, msg = null) => {
  try {
    if (OWNER_IDS.includes(userId)) {
      return true;
    }

    const config = await getConfig(chatId);
    if (!config.operators || config.operators.length === 0) {
      return false;
    }

    if (msg && msg.from && msg.from.username) {
      return config.operators.includes(msg.from.username);
    }

    console.log(`用户 ${userId} 没有username信息，拒绝权限`);
    return false;
  } catch (error) {
    console.error("权限检查错误:", error);
    return false;
  }
};

const setupBotHandlers = () => {
  bot.on("polling_error", (error) => {
    console.error("Polling error:", error);
  });

  bot.on("my_chat_member", async (update) => {
    const chatId = update.chat.id;
    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    const addedBy = update.from.id;
    const addedByUsername = update.from.username;
    if (
      (oldStatus === "left" &&
        (newStatus === "member" || newStatus === "administrator")) ||
      (oldStatus === "kicked" &&
        (newStatus === "member" || newStatus === "administrator"))
    ) {
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "📱 获取我的 Telegram ID",
              url: "https://t.me/userinfobot",
            },
          ],
        ],
      };

      const isAuthorized = OWNER_IDS.includes(addedBy);
      if (isAuthorized) {
        const welcomeKeyboard = {
          inline_keyboard: [
            [
              {
                text: "📖 查看使用说明",
                callback_data: "show_help",
              },
              {
                text: "📱 获取 Telegram ID",
                url: "https://t.me/userinfobot",
              },
            ],
          ],
        };

        await bot.sendMessage(
          chatId,
          `🎉 机器人已开启，请开始记账\n\n` +
            `添加者信息：\n` +
            `用户名: @${addedByUsername || "未设置"}\n` +
            `用户 ID: ${addedBy}\n` +
            `状态: ✅ 已授权\n\n` +
            `点击下方按钮查看使用说明或获取 ID 信息`,
          {
            reply_markup: welcomeKeyboard,
          }
        );

        console.log(
          `Bot 被授权用户 ${addedBy} (@${addedByUsername}) 添加到群组 ${chatId}`
        );
        await getConfig(chatId);
      } else {
        await bot.sendMessage(
          chatId,
          `⚠️ 此 Bot 仅供授权使用\n\n` +
            `您的信息：\n` +
            `用户名: @${addedByUsername || "未设置"}\n` +
            `用户 ID: ${addedBy}\n` +
            `状态: ❌ 未授权\n\n` +
            `如需授权，请将您的 ID 发送给 Bot 管理员\n` +
            `点击下方按钮可通过 @userinfobot 查看您的详细信息`,
          {
            reply_markup: keyboard,
          }
        );
        console.log(`未授权用户尝试添加 Bot：`);
        console.log(`  用户名: @${addedByUsername || "未设置"}`);
        console.log(`  用户 ID: ${addedBy}`);
        console.log(`  群组 ID: ${chatId}`);
        setTimeout(async () => {
          await bot.sendMessage(chatId, "Bot 将自动离开未授权的群组");
          await bot.leaveChat(chatId);
        }, 5000);
      }
    }
  });
  bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    if (data === "show_help") {
      if (!(await checkPermission(chatId, userId))) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ 只有管理员和操作员可以查看帮助",
          show_alert: true,
        });
        return;
      }
      const helpText = `
🤖 机器人使用说明

管理员命令：
- 设置费率[数字] - 设置交易费率
- 设置汇率[数字] - 设置汇率  
- 设置出款汇率[数字] - 设置出款汇率
- 设置手续费[数字] - 设置单笔手续费
- 设置操作员 @用户名 - 添加操作员
- 上课 - 开始营业
- 下课 - 结束营业
- 撤销[消息ID] - 撤销指定交易
- 删除账单 - 删除今日所有交易记录

交易命令：
- +[金额] 或 +[金额] (备注) - 记录入款
- 下发[USDT金额] 或 下发[USDT金额] (备注) - 记录下发
- F[金额] 或 F[金额] (备注) - 代付计算

查询命令：
- 状态 - 查看今日报告
- [数字][+-*/][数字] - 计算器

示例：
- 设置费率2
- +1000000 或 +1000000 (工资)
- 下发59.39 或 下发-100 (调整)
- F1000000 或 F-500000 (退款)
- 撤销126
- 删除账单
- 100+200
`;
      await bot.sendMessage(chatId, helpText);
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  });

  bot.on("message", async (msg) => {
    const text = (msg.text || msg.caption || "").trim();
    if (!text) return;

    const chatId = msg.chat.id;
    const username = msg.from.username;
    const messageId = msg.message_id;
    const userId = msg.from.id;

    try {
      const config = await getConfig(chatId);

      if (text.match(/^设置费率\s*(\d+\.?\d*)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以设置费率");
          return;
        }

        const rate = parseFloat(text.match(/^设置费率\s*(\d+\.?\d*)$/)[1]);
        if (rate < 0 || rate > 100) {
          bot.sendMessage(chatId, "❌ 费率必须在0-100%之间");
          return;
        }
        config.feeRate = rate;
        await config.save();
        bot.sendMessage(chatId, `费率设置成功，当前交易费率为：${rate}%`);
        return;
      }

      if (text.match(/^设置汇率\s*(\d+\.?\d*)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以设置汇率");
          return;
        }
        const rate = parseFloat(text.match(/^设置汇率\s*(\d+\.?\d*)$/)[1]);
        if (rate <= 0) {
          bot.sendMessage(chatId, "❌ 汇率必须大于0");
          return;
        }
        config.inRate = rate;
        await config.save();
        bot.sendMessage(chatId, `汇率设置成功，当前汇率为：${rate}`);
        return;
      }

      if (text.match(/^设置出款汇率\s*(\d+\.?\d*)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以设置汇率");
          return;
        }
        const rate = parseFloat(text.match(/^设置出款汇率\s*(\d+\.?\d*)$/)[1]);
        if (rate <= 0) {
          bot.sendMessage(chatId, "❌ 汇率必须大于0");
          return;
        }
        config.outRate = rate;
        await config.save();
        bot.sendMessage(chatId, `出款汇率设置成功，当前出款汇率为：${rate}`);
        return;
      }

      if (text.match(/^设置手续费\s*(\d+\.?\d*)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以设置手续费");
          return;
        }
        const fee = parseFloat(text.match(/^设置手续费\s*(\d+\.?\d*)$/)[1]);
        if (fee < 0) {
          bot.sendMessage(chatId, "❌ 手续费不能为负数");
          return;
        }
        config.handlingFee = fee;
        await config.save();
        bot.sendMessage(chatId, `手续费设置成功，当前手续费为：${fee}`);
        return;
      }

      if (text.match(/^设置操作员\s+(.+)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员可以设置操作员");
          return;
        }
        const operatorsText = text.match(/^设置操作员\s+(.+)$/)[1];
        const operators = operatorsText.match(/@?\w+/g) || [];
        const cleanedOperators = operators.map((op) => op.replace("@", ""));
        const newOperators = cleanedOperators.filter(
          (op) => !config.operators.includes(op)
        );
        const existingOperators = cleanedOperators.filter((op) =>
          config.operators.includes(op)
        );

        if (newOperators.length > 0) {
          config.operators.push(...newOperators);
          await config.save();
          let message = `✅ 成功添加 ${newOperators.length} 个操作员：\n`;
          message += newOperators.map((op) => `@${op}`).join(", ");
          if (existingOperators.length > 0) {
            message += `\n\n⚠️ 以下操作员已存在：\n`;
            message += existingOperators.map((op) => `@${op}`).join(", ");
          }
          bot.sendMessage(chatId, message);
        } else {
          bot.sendMessage(chatId, `⚠️ 所有操作员都已存在，无需重复添加`);
        }
        return;
      }

      if (text === "查看操作员") {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员可以查看操作员");
          return;
        }
        if (config.operators.length === 0) {
          bot.sendMessage(chatId, "当前没有设置任何操作员");
        } else {
          let message = `📋 当前操作员列表（共 ${config.operators.length} 人）：\n\n`;
          message += config.operators
            .map((op, index) => `${index + 1}. @${op}`)
            .join("\n");
          bot.sendMessage(chatId, message);
        }
        return;
      }

      if (text.match(/^删除操作员\s+(.+)$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员可以删除操作员");
          return;
        }
        const operatorsText = text.match(/^删除操作员\s+(.+)$/)[1];
        const operators = operatorsText.match(/@?\w+/g) || [];
        const cleanedOperators = operators.map((op) => op.replace("@", ""));
        const deletedOperators = [];
        const notFoundOperators = [];
        cleanedOperators.forEach((op) => {
          const index = config.operators.indexOf(op);
          if (index > -1) {
            config.operators.splice(index, 1);
            deletedOperators.push(op);
          } else {
            notFoundOperators.push(op);
          }
        });
        if (deletedOperators.length > 0) {
          await config.save();
          let message = `✅ 成功删除 ${deletedOperators.length} 个操作员：\n`;
          message += deletedOperators.map((op) => `@${op}`).join(", ");
          if (notFoundOperators.length > 0) {
            message += `\n\n⚠️ 以下操作员不存在：\n`;
            message += notFoundOperators.map((op) => `@${op}`).join(", ");
          }
          bot.sendMessage(chatId, message);
        } else {
          bot.sendMessage(chatId, `❌ 没有找到任何需要删除的操作员`);
        }
        return;
      }

      if (text === "清空操作员") {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员可以清空操作员");
          return;
        }
        if (config.operators.length === 0) {
          bot.sendMessage(chatId, "当前没有任何操作员");
        } else {
          const count = config.operators.length;
          config.operators = [];
          await config.save();
          bot.sendMessage(chatId, `✅ 已清空所有 ${count} 个操作员`);
        }
        return;
      }

      if (text === "上课") {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以操作营业状态");
          return;
        }
        config.isOpen = true;
        await config.save();
        bot.sendMessage(chatId, "本群已开始营业");
        return;
      }

      if (text === "下课") {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以操作营业状态");
          return;
        }
        config.isOpen = false;
        await config.save();
        bot.sendMessage(
          chatId,
          "本群今日已下课，\n如需交易，请在该群恢复营业后在群内交易！ 切勿私下交易！！！\n如有业务咨询请联系群老板/业务员"
        );
        return;
      }

      if (text === "状态" || text === "status" || text === "+0") {
        const report = await formatReport(chatId);
        sendReportWithButton(chatId, report);
        return;
      }

      if (text.match(/^\+(\d+)(\s*[\(（](.+)[\)）])?$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以记录交易");
          return;
        }
        if (!config.inRate || config.inRate === 0) {
          bot.sendMessage(chatId, "❌ 请先设置汇率，当前汇率为0");
          return;
        }
        const match = text.match(/^\+(\d+)(\s*[\(（](.+)[\)）])?$/);
        const amount = parseInt(match[1]);
        const remark = match[3] || null;

        if (amount <= 0) {
          bot.sendMessage(chatId, "❌ 入款金额必须大于0");
          return;
        }

        const calculatedUsdt =
          (amount / config.inRate) * (1 - config.feeRate / 100);

        const displayName = `${msg.from.first_name}${
          msg.from.last_name ? " " + msg.from.last_name : ""
        }`;

        const transaction = new Transaction({
          chatId: chatId.toString(),
          groupName: msg.chat.title || msg.chat.username || "Private Chat",
          type: "入款",
          amount,
          rate: config.inRate,
          feeRate: config.feeRate,
          messageId,
          username,
          displayName: displayName,
          remark: remark,
          userId: userId,
          date: getTodayString(),
          calculatedUsdt,
        });

        await transaction.save();
        await SummaryService.updateSummaryOnTransaction(transaction, config);
        const report = await formatReport(chatId, transaction._id.toString());
        sendReportWithButton(chatId, report);
        return;
      }

      if (text.match(/^下发\s*(-?\d+\.?\d*)(\s*[\(（](.+)[\)）])?$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以记录下发");
          return;
        }
        const match = text.match(
          /^下发\s*(-?\d+\.?\d*)(\s*[\(（](.+)[\)）])?$/
        );
        const usdt = parseFloat(match[1]);
        const remark = match[3] || null;

        if (usdt === 0) {
          bot.sendMessage(chatId, "❌ 下发金额不能为0");
          return;
        }

        const displayName = `${msg.from.first_name}${
          msg.from.last_name ? " " + msg.from.last_name : ""
        }`;

        const transaction = new Transaction({
          chatId: chatId.toString(),
          groupName: msg.chat.title || msg.chat.username || "Private Chat",
          type: "下发",
          usdt,
          messageId,
          username,
          displayName: displayName,
          remark: remark,
          userId: userId,
          date: getTodayString(),
        });

        await transaction.save();
        await SummaryService.updateSummaryOnTransaction(transaction, config);
        const report = await formatReport(chatId);
        sendReportWithButton(chatId, report);
        return;
      }

      if (text.match(/^(\d+\.?\d*)\s*([\+\-\*\/])\s*(\d+\.?\d*)$/)) {
        const match = text.match(/^(\d+\.?\d*)\s*([\+\-\*\/])\s*(\d+\.?\d*)$/);
        const num1 = parseFloat(match[1]);
        const operator = match[2];
        const num2 = parseFloat(match[3]);

        if (operator === "/" && num2 === 0) {
          bot.sendMessage(chatId, "❌ 除数不能为0");
          return;
        }

        let result;
        switch (operator) {
          case "+":
            result = num1 + num2;
            break;
          case "-":
            result = num1 - num2;
            break;
          case "*":
            result = num1 * num2;
            break;
          case "/":
            result = num1 / num2;
            break;
        }

        bot.sendMessage(chatId, `${text}=${formatNumber(result)}`);
        return;
      }

      if (text.match(/^[\d\.\+\-\*\/\s]+$/)) {
        try {
          const expression = text.replace(/\s/g, "");
          const tokens = expression.match(/(\d+\.?\d*|[\+\-\*\/])/g);
          if (!tokens || tokens.length < 3 || tokens.length % 2 === 0) {
            // bot.sendMessage(chatId, "❌ 表达式格式错误");
            return;
          }
          for (let i = 0; i < tokens.length; i++) {
            if (i % 2 === 0) {
              if (!/^\d+\.?\d*$/.test(tokens[i])) {
                // bot.sendMessage(chatId, "❌ 表达式格式错误");
                return;
              }
            } else {
              if (!/^[\+\-\*\/]$/.test(tokens[i])) {
                // bot.sendMessage(chatId, "❌ 表达式格式错误");
                return;
              }
            }
          }
          let result = evaluateExpression(tokens);
          bot.sendMessage(chatId, `${text} = ${formatNumber(result)}`);
          return;
        } catch (error) {
          bot.sendMessage(chatId, "❌ 计算出错");
          return;
        }
      }

      if (text.match(/^[Ff]\s*(-?\d+\.?\d*)(\s*[\(（](.+)[\)）])?$/)) {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和操作员可以记录代付");
          return;
        }
        if (!config.outRate || config.outRate === 0) {
          bot.sendMessage(chatId, "❌ 请先设置出款汇率，当前出款汇率为0");
          return;
        }

        const match = text.match(
          /^[Ff]\s*(-?\d+\.?\d*)(\s*[\(（](.+)[\)）])?$/
        );
        const amount = parseFloat(match[1]);
        const remark = match[3] || null;

        if (amount <= 0) {
          bot.sendMessage(chatId, "❌ 代付金额必须大于0");
          return;
        }

        const result = amount / config.outRate + config.handlingFee;
        const displayName = `${msg.from.first_name}${
          msg.from.last_name ? " " + msg.from.last_name : ""
        }`;

        const transaction = new Transaction({
          chatId: chatId.toString(),
          groupName: msg.chat.title || msg.chat.username || "Private Chat",
          type: "代付",
          amount: amount,
          usdt: result,
          rate: config.outRate,
          messageId,
          username,
          displayName: displayName,
          remark: remark,
          userId: userId,
          date: getTodayString(),
        });

        await transaction.save();
        await SummaryService.updateSummaryOnTransaction(transaction, config);
        const transactions = await getTodayTransactions(chatId);
        const stats = calculateStats(transactions, config.feeRate);
        const adjustedActualUsdt =
          Math.floor(stats.adjustedActualUsdt * 100) / 100;
        const outUsdt = Math.floor(stats.totalOutUsdt * 100) / 100;
        const unDispensed =
          Math.floor((stats.adjustedActualUsdt - stats.totalOutUsdt) * 100) /
          100;
        const totalPayoutAmount = stats.代付.reduce(
          (sum, t) => sum + t.amount,
          0
        );
        let message = `F${formatNumber(amount)}\n`;
        message += `应下发：${adjustedActualUsdt.toFixed(2)}U\n`;
        message += `已下发：${outUsdt.toFixed(2)}U\n`;
        message += `未下发：${unDispensed.toFixed(2)}U`;

        if (remark) {
          message = `F${formatNumber(amount)} (${remark})\n`;
          message += `应下发：${adjustedActualUsdt.toFixed(2)}U\n`;
          message += `已下发：${outUsdt.toFixed(2)}U\n`;
          message += `未下发：${unDispensed.toFixed(2)}U`;
        }

        // bot.sendMessage(chatId, message);
        const report = await formatReport(chatId);
        sendReportWithButton(chatId, report);
        return;
      }

      if (text.match(/^撤销(\d+)$/)) {
        const messageId = parseInt(text.match(/^撤销(\d+)$/)[1]);
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员可以撤销交易");
          return;
        }
        const today = getTodayString();
        const { start, end } = getBusinessDayRange(today);
        const transaction = await Transaction.findOne({
          messageId: messageId,
          chatId: chatId.toString(),
          timestamp: {
            $gte: start,
            $lte: end,
          },
        });
        if (transaction) {
          const type = transaction.type;
          const amount =
            transaction.type === "入款"
              ? formatNumber(transaction.amount)
              : transaction.usdt + "U";
          await SummaryService.reverseTransaction(transaction, config);
          await Transaction.deleteOne({ _id: transaction._id });
          const report = await formatReport(chatId);
          bot.sendMessage(chatId, `已撤销${type} ${amount}\n\n${report}`, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        } else {
          bot.sendMessage(chatId, "找不到该交易记录");
        }
        return;
      }

      if (text === "/help" || text === "帮助") {
        const helpText = `
🤖 机器人使用说明

管理员命令：
- 设置费率[数字] - 设置交易费率
- 设置汇率[数字] - 设置汇率  
- 设置出款汇率[数字] - 设置出款汇率
- 设置手续费[数字] - 设置单笔手续费
- 设置操作员 @用户名 - 添加操作员
- 上课 - 开始营业
- 下课 - 结束营业
- 撤销[消息ID] - 撤销指定交易
- 删除账单 - 删除今日所有交易记录

交易命令：
- +[金额] 或 +[金额] (备注) - 记录入款
- 下发[USDT金额] 或 下发[USDT金额] (备注) - 记录下发
- F[金额] 或 F[金额] (备注) - 代付计算

查询命令：
- 状态 - 查看今日报告
- [数字][+-*/][数字] - 计算器

示例：
- 设置费率2
- +1000000 或 +1000000 (工资)
- 下发59.39 或 下发-100 (调整)
- F1000000 或 F-500000 (退款)
- 撤销126
- 删除账单
- 100+200
  `;
        bot.sendMessage(chatId, helpText);
        return;
      }

      if (text === "删除账单") {
        if (!(await checkPermission(chatId, userId, msg))) {
          bot.sendMessage(chatId, "❌ 只有管理员和指定操作员可以删除账单");
          return;
        }
        deleteConfirmations.set(`${chatId}_${userId}`, Date.now());
        setTimeout(() => {
          deleteConfirmations.delete(`${chatId}_${userId}`);
        }, 5 * 60 * 1000);
        bot.sendMessage(
          chatId,
          "⚠️ 请问是否确定要删除今日账单？\n\n此操作将删除今日所有交易记录且无法恢复！\n\n请在5分钟内回复「确定」以确认删除。"
        );
        return;
      }

      if (text === "确定") {
        const confirmKey = `${chatId}_${userId}`;
        const confirmTime = deleteConfirmations.get(confirmKey);
        if (!confirmTime) {
          return;
        }
        if (Date.now() - confirmTime > 5 * 60 * 1000) {
          deleteConfirmations.delete(confirmKey);
          bot.sendMessage(chatId, "❌ 确认超时，请重新执行删除账单命令");
          return;
        }
        deleteConfirmations.delete(confirmKey);
        try {
          const result = await deleteTodayTransactions(chatId);
          bot.sendMessage(
            chatId,
            `✅ 已删除今日账单\n\n共删除 ${result.deletedCount} 条交易记录`
          );
          const today = getTodayString();
          await SummaryService.rebuildSummaries(today, today);
          const report = await formatReport(chatId);
          sendReportWithButton(chatId, report);
        } catch (error) {
          console.error("删除账单错误:", error);
          bot.sendMessage(chatId, "❌ 删除账单时出现错误，请稍后重试");
        }
        return;
      }
    } catch (error) {
      console.error("处理消息错误:", error);
      bot.sendMessage(chatId, "❌ 处理消息时出现错误，请稍后重试");
    }
  });
};

// const setupCronJobs = () => {
//   cron.schedule(
//     "0 22 * * *",
//     async () => {
//       console.log("执行每日6点重置任务 (UTC+8)");

//       try {
//         const yesterday = moment().tz("Asia/Kuala_Lumpur");
//         if (yesterday.hour() < 6) {
//           yesterday.subtract(2, "days");
//         } else {
//           yesterday.subtract(1, "day");
//         }
//         const yesterdayStr = yesterday.format("YYYY-MM-DD");
//         const { start, end } = getBusinessDayRange(yesterdayStr);

//         const configs = await Config.find({});

//         for (const config of configs) {
//           const transactions = await Transaction.find({
//             chatId: config.chatId,
//             timestamp: {
//               $gte: start,
//               $lte: end,
//             },
//           });

//           if (transactions.length > 0) {
//             const stats = calculateStats(transactions, config.feeRate);
//             const dailyReport = new DailyReport({
//               chatId: config.chatId,
//               date: yesterdayStr,
//               totalInAmount: stats.totalInAmount,
//               totalInUsdt: stats.totalInUsdt,
//               totalOutUsdt: stats.totalOutUsdt,
//               transactionCount: {
//                 入款: stats.入款.length,
//                 下发: stats.下发.length,
//                 代付: stats.代付.length,
//               },
//               report: await formatReport(config.chatId),
//             });
//             await dailyReport.save();
//           }

//           config.lastReset = new Date();
//           await config.save();
//         }

//         console.log("每日重置任务完成");
//       } catch (error) {
//         console.error("每日重置任务错误:", error);
//       }
//     },
//     {
//       scheduled: true,
//       timezone: "UTC",
//     }
//   );
// };

const convertToChatId = (urlChatId) => {
  if (
    urlChatId.toString().length >= 10 &&
    urlChatId.toString().startsWith("100")
  ) {
    return `-${urlChatId}`;
  }
  return `-${urlChatId}`;
};

function evaluateExpression(tokens) {
  let i = 1;
  while (i < tokens.length) {
    if (tokens[i] === "*" || tokens[i] === "/") {
      const left = parseFloat(tokens[i - 1]);
      const right = parseFloat(tokens[i + 1]);
      let result;

      if (tokens[i] === "*") {
        result = left * right;
      } else {
        if (right === 0) throw new Error("除数不能为0");
        result = left / right;
      }
      tokens.splice(i - 1, 3, result.toString());
    } else {
      i += 2;
    }
  }
  i = 1;
  while (i < tokens.length) {
    const left = parseFloat(tokens[i - 1]);
    const right = parseFloat(tokens[i + 1]);
    let result;

    if (tokens[i] === "+") {
      result = left + right;
    } else {
      result = left - right;
    }
    tokens.splice(i - 1, 3, result.toString());
  }
  return parseFloat(tokens[0]);
}

router.get("/api/config/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const config = await getConfig(chatId);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/transactions/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const { startDate, endDate, date, page = 1, limit = 20, type } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = { chatId: chatId };
    if (type) {
      query.type = type;
    }

    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate);
      const endRange = getBusinessDayRange(endDate);
      query.timestamp = {
        $gte: startRange.start,
        $lte: endRange.end,
      };
    } else if (date) {
      const { start, end } = getBusinessDayRange(date);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    } else {
      const today = getTodayString();
      const { start, end } = getBusinessDayRange(today);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    res.json({
      data: transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get("/api/report/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const { startDate, endDate, date } = req.query;
    let query = { chatId: chatId };
    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate);
      const endRange = getBusinessDayRange(endDate);
      query.timestamp = {
        $gte: startRange.start,
        $lte: endRange.end,
      };
    } else if (date) {
      const { start, end } = getBusinessDayRange(date);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    } else {
      const today = getTodayString();
      const { start, end } = getBusinessDayRange(today);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    }
    const transactions = await Transaction.find(query).sort({ timestamp: 1 });
    const config = await getConfig(chatId);
    const stats = calculateStats(transactions, config.feeRate);
    const processedStats = {
      ...stats,
      totalActualUsdt: Math.floor(stats.totalActualUsdt * 100) / 100,
      totalOutUsdt: Math.floor(stats.totalOutUsdt * 100) / 100,
      totalPayoutAmount: stats.totalPayoutAmount,
      transactionCount: {
        入款: stats.入款.length,
        下发: stats.下发.length,
        代付: stats.代付.length,
      },
    };
    res.json({
      report: await formatReport(chatId),
      stats: processedStats,
      config,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/history/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const { limit = 30 } = req.query;
    const reports = await DailyReport.find({ chatId: chatId })
      .sort({ date: -1 })
      .limit(parseInt(limit));
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/stats/users/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const { startDate, endDate, date, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    let matchStage = { chatId: chatId };
    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate);
      const endRange = getBusinessDayRange(endDate);
      matchStage.timestamp = {
        $gte: startRange.start,
        $lte: endRange.end,
      };
    } else if (date) {
      const { start, end } = getBusinessDayRange(date);
      matchStage.timestamp = {
        $gte: start,
        $lte: end,
      };
    } else {
      const today = getTodayString();
      const { start, end } = getBusinessDayRange(today);
      matchStage.timestamp = {
        $gte: start,
        $lte: end,
      };
    }
    const pipeline = [
      { $match: matchStage },
      { $match: { displayName: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$displayName",
          username: { $first: "$username" },
          入款count: {
            $sum: { $cond: [{ $eq: ["$type", "入款"] }, 1, 0] },
          },
          入款amount: {
            $sum: { $cond: [{ $eq: ["$type", "入款"] }, "$amount", 0] },
          },
          入款usdt: {
            $sum: {
              $cond: [
                { $eq: ["$type", "入款"] },
                { $divide: ["$amount", "$rate"] },
                0,
              ],
            },
          },
          下发count: {
            $sum: { $cond: [{ $eq: ["$type", "下发"] }, 1, 0] },
          },
          下发usdt: {
            $sum: { $cond: [{ $eq: ["$type", "下发"] }, "$usdt", 0] },
          },
          代付count: {
            $sum: { $cond: [{ $eq: ["$type", "代付"] }, 1, 0] },
          },
          代付amount: {
            $sum: { $cond: [{ $eq: ["$type", "代付"] }, "$amount", 0] },
          },
          代付usdt: {
            $sum: { $cond: [{ $eq: ["$type", "代付"] }, "$usdt", 0] },
          },
        },
      },
      {
        $project: {
          displayName: "$_id",
          username: 1,
          入款: {
            count: "$入款count",
            amount: "$入款amount",
            usdt: "$入款usdt",
          },
          下发: {
            count: "$下发count",
            usdt: "$下发usdt",
          },
          代付: {
            count: "$代付count",
            amount: "$代付amount",
            usdt: "$代付usdt",
          },
        },
      },
      { $sort: { displayName: 1 } },
      { $skip: skip },
      { $limit: limitNum },
    ];

    const [userStats, totalCount] = await Promise.all([
      Transaction.aggregate(pipeline),
      Transaction.distinct("displayName", matchStage),
    ]);

    res.json({
      data: userStats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount.length,
        totalPages: Math.ceil(totalCount.length / limitNum),
        hasNext: pageNum < Math.ceil(totalCount.length / limitNum),
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/stats/rates/:chatId", async (req, res) => {
  try {
    const chatId = convertToChatId(req.params.chatId);
    const { startDate, endDate, date } = req.query;

    let query = {
      chatId: chatId,
      type: "入款",
    };

    if (startDate && endDate) {
      const startRange = getBusinessDayRange(startDate);
      const endRange = getBusinessDayRange(endDate);
      query.timestamp = {
        $gte: startRange.start,
        $lte: endRange.end,
      };
    } else if (date) {
      const { start, end } = getBusinessDayRange(date);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    } else {
      const today = getTodayString();
      const { start, end } = getBusinessDayRange(today);
      query.timestamp = {
        $gte: start,
        $lte: end,
      };
    }
    const transactions = await Transaction.find(query);
    const rateStats = {};

    transactions.forEach((t) => {
      if (!rateStats[t.rate]) {
        rateStats[t.rate] = {
          rate: t.rate,
          count: 0,
          amount: 0,
          usdt: 0,
        };
      }

      rateStats[t.rate].count++;
      rateStats[t.rate].amount += t.amount;
      rateStats[t.rate].usdt += t.amount / t.rate;
    });

    res.json(Object.values(rateStats));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

process.on("SIGINT", () => {
  if (bot) {
    console.log("\n正在停止 Bot...");
    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      bot.stopPolling();
    }
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  if (bot) {
    console.log("\n正在停止 Bot...");
    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      bot.stopPolling();
    }
    process.exit(0);
  }
});
process.on("uncaughtException", (err) => {
  console.error("未捕获的异常:", err);
  if (bot) {
    bot.stopPolling();
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("未处理的 Promise 拒绝:", reason);
});

router.init = () => {
  initializeBot();
  // setupCronJobs();
};

router.getBot = () => bot;

module.exports = router;
