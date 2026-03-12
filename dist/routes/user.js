"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../utils/db"));
const authWallet_1 = require("../middleware/authWallet");
const router = (0, express_1.Router)();
/**
 * GET /api/user/profile
 * Возвращает профиль текущего пользователя (статус привязки Telegram)
 */
router.get('/profile', authWallet_1.authenticateWallet, async (req, res) => {
    const user = await db_1.default.user.findUnique({
        where: { walletAddress: req.user.walletAddress },
    });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json({
        id: user.id,
        walletAddress: user.walletAddress,
        telegramId: user.telegramId?.toString() || null,
        telegramUsername: user.telegramUsername,
        telegramLinkedAt: user.telegramLinkedAt,
    });
});
/**
 * GET /api/user/generate-nonce
 * Генерирует одноразовый nonce для привязки Telegram (10 мин)
 */
router.get('/generate-nonce', authWallet_1.authenticateWallet, async (req, res) => {
    const wallet = req.user.walletAddress;
    const user = await db_1.default.user.findUnique({ where: { walletAddress: wallet } });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    // Уже привязан?
    if (user.telegramId) {
        res.status(400).json({
            error: 'Telegram already linked',
            telegram: {
                id: user.telegramId.toString(),
                username: user.telegramUsername,
            }
        });
        return;
    }
    const nonce = crypto_1.default.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db_1.default.user.update({
        where: { walletAddress: wallet },
        data: { linkNonce: nonce, linkNonceExpiry: expiresAt },
    });
    const botUsername = process.env.TG_BOT_USERNAME || 'GenesisProtocol_Bot';
    const telegramLink = `https://t.me/${botUsername}/app?startapp=${nonce}`;
    res.json({ nonce, expiresAt: expiresAt.toISOString(), telegramLink });
});
/**
 * POST /api/user/generate-nonce-by-wallet
 * Генерирует nonce по walletAddress (без JWT — для dev/MVP)
 */
router.post('/generate-nonce-by-wallet', async (req, res) => {
    const { walletAddress } = req.body;
    if (!walletAddress) {
        res.status(400).json({ error: 'walletAddress required' });
        return;
    }
    const wallet = walletAddress.toLowerCase();
    // Создаём юзера если нет
    let user = await db_1.default.user.findUnique({ where: { walletAddress: wallet } });
    if (!user) {
        user = await db_1.default.user.create({ data: { walletAddress: wallet } });
    }
    if (user.telegramId) {
        res.status(400).json({
            error: 'Telegram already linked',
            telegram: { id: user.telegramId.toString(), username: user.telegramUsername }
        });
        return;
    }
    const nonce = crypto_1.default.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db_1.default.user.update({
        where: { walletAddress: wallet },
        data: { linkNonce: nonce, linkNonceExpiry: expiresAt },
    });
    const botUsername = process.env.TG_BOT_USERNAME || 'GenesisProtocol_Bot';
    const telegramLink = `https://t.me/${botUsername}/app?startapp=${nonce}`;
    res.json({ nonce, expiresAt: expiresAt.toISOString(), telegramLink });
});
/**
 * POST /api/user/check-link
 * Проверяет статус привязки Telegram по walletAddress (без JWT)
 */
router.post('/check-link', async (req, res) => {
    const { walletAddress } = req.body;
    if (!walletAddress) {
        res.status(400).json({ error: 'walletAddress required' });
        return;
    }
    const user = await db_1.default.user.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
    });
    res.json({
        linked: !!user?.telegramId,
        telegramUsername: user?.telegramUsername || null,
    });
});
exports.default = router;
//# sourceMappingURL=user.js.map