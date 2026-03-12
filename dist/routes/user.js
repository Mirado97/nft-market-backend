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
 * Возвращает профиль текущего пользователя
 */
router.get('/profile', authWallet_1.authenticateWallet, async (req, res) => {
    try {
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
    }
    catch (err) {
        console.error('profile error:', err);
        res.status(500).json({
            error: 'profile failed',
            details: err?.message || 'Unknown error',
        });
    }
});
/**
 * GET /api/user/generate-nonce
 * Генерирует nonce для привязки Telegram (с JWT)
 */
router.get('/generate-nonce', authWallet_1.authenticateWallet, async (req, res) => {
    try {
        const wallet = req.user.walletAddress;
        const user = await db_1.default.user.findUnique({ where: { walletAddress: wallet } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
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
    }
    catch (err) {
        console.error('generate-nonce error:', err);
        res.status(500).json({
            error: 'generate-nonce failed',
            details: err?.message || 'Unknown error',
        });
    }
});
/**
 * POST /api/user/generate-nonce-by-wallet
 * Генерирует nonce по walletAddress (без JWT)
 */
router.post('/generate-nonce-by-wallet', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress) {
            res.status(400).json({ error: 'walletAddress required' });
            return;
        }
        const wallet = walletAddress.toLowerCase();
        let user = await db_1.default.user.findUnique({ where: { walletAddress: wallet } });
        if (!user) {
            user = await db_1.default.user.create({ data: { walletAddress: wallet } });
        }
        if (user.telegramId) {
            res.status(400).json({
                error: 'Telegram already linked',
                telegram: {
                    id: user.telegramId.toString(),
                    username: user.telegramUsername
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
    }
    catch (err) {
        console.error('generate-nonce-by-wallet error:', err);
        res.status(500).json({
            error: 'generate-nonce-by-wallet failed',
            details: err?.message || 'Unknown error',
        });
    }
});
/**
 * POST /api/user/check-link
 * Проверяет статус привязки Telegram по walletAddress
 */
router.post('/check-link', async (req, res) => {
    try {
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
    }
    catch (err) {
        console.error('check-link error:', err);
        res.status(500).json({
            error: 'check-link failed',
            details: err?.message || 'Unknown error',
        });
    }
});
exports.default = router;
//# sourceMappingURL=user.js.map