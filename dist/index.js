"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const auth_1 = __importDefault(require("./routes/auth"));
const user_1 = __importDefault(require("./routes/user"));
const telegram_1 = __importDefault(require("./routes/telegram"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';  // 🔥 ЖЁСТКИЙ хардкод для Railway

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '15mb' })); // base64 images can be large

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', auth_1.default);
app.use('/api/user', user_1.default);
app.use('/api/telegram', telegram_1.default);

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    console.log(`\n🧬 GENESIS Backend running on http://${HOST}:${PORT}`);
    console.log(`   Health: http://${HOST}:${PORT}/api/health`);
    console.log(`   CORS origin: ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n`);
});
//# sourceMappingURL=index.js.map
