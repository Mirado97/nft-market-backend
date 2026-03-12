"use strict";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const authModule = require("./routes/auth");
const authRoutes = authModule.default || authModule;

const userModule = require("./routes/user");
const userRoutes = userModule.default || userModule;

const telegramModule = require("./routes/telegram");
const telegramRoutes = telegramModule.default || telegramModule;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
    origin: [
        "https://nft-market-frontend-omega.vercel.app",
        "https://nft-market-frontend-production.up.railway.app",
        "http://localhost:5173"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

app.use(express.json({ limit: "15mb" }));

app.get("/api/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/telegram", telegramRoutes);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});
