"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const siwe_1 = require("siwe");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../utils/db"));
const router = (0, express_1.Router)();
// Хранилище nonce (в продакшене — Redis)
const nonceStore = new Map();
/**
 * GET /api/auth/nonce
 * Генерирует nonce для SiWE
 */
router.get('/nonce', (_req, res) => {
    const nonce = crypto_1.default.randomBytes(16).toString('hex');
    // Сохраняем nonce с таймстампом (5 минут жизни)
    nonceStore.set(nonce, { nonce, createdAt: Date.now() });
    res.json({ nonce });
});
/**
 * POST /api/auth/wallet-login
 * Sign-In with Ethereum → JWT
 * Body: { message: string, signature: string }
 */
router.post('/wallet-login', async (req, res) => {
    const { message, signature } = req.body;
    if (!message || !signature) {
        res.status(400).json({ error: 'message and signature required' });
        return;
    }
    try {
        const siweMessage = new siwe_1.SiweMessage(message);
        const { data: verified } = await siweMessage.verify({ signature });
        // Проверяем nonce
        const storedNonce = nonceStore.get(verified.nonce);
        if (!storedNonce || Date.now() - storedNonce.createdAt > 5 * 60 * 1000) {
            res.status(401).json({ error: 'Invalid or expired nonce' });
            return;
        }
        nonceStore.delete(verified.nonce);
        const walletAddress = verified.address.toLowerCase();
        // Создаём или находим пользователя
        let user = await db_1.default.user.findUnique({ where: { walletAddress } });
        if (!user) {
            user = await db_1.default.user.create({ data: { walletAddress } });
        }
        // Генерируем JWT (24 часа)
        const token = jsonwebtoken_1.default.sign({ walletAddress, userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({
            token,
            user: {
                id: user.id,
                walletAddress: user.walletAddress,
                telegramId: user.telegramId?.toString() || null,
                telegramUsername: user.telegramUsername,
            }
        });
    }
    catch (err) {
        console.error('SiWE verification failed:', err.message);
        res.status(401).json({ error: 'Signature verification failed' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map