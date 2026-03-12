"use strict";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
}));

app.use(express.json({ limit: "15mb" }));

app.get("/api/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});
