const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const app = express();
const telegramRouter = require("./routes/telegrambot");
const dailySummaryRouter = require("./routes/dailysummary");

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3005",
  "https://www.luckybot7.com",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(telegramRouter);
app.use(dailySummaryRouter);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB 连接成功");
    telegramRouter.init();
  })
  .catch((error) => {
    console.error("❌ MongoDB 连接失败:", error);
    process.exit(1);
  });

app.get("/", (req, res) => {
  res.status(403).send({
    error: "Access Forbidden",
    message: "You do not have permission to access this resource.",
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.post("/webhook/:token", async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = telegramRouter.getBot();
  if (req.params.token === token && bot) {
    try {
      await bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error("处理失败:", error);
      res.sendStatus(200);
    }
  } else {
    res.sendStatus(403);
  }
});

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(
    `Server is running on port: ${PORT} in ${process.env.NODE_ENV} mode`
  );
});
