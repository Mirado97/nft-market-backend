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

function generateSessionToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

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
            telegramId: user.telegramId ? user.telegramId.toString() : null,
            telegramUsername: user.telegramUsername,
            telegramLinkedAt: user.telegramLinkedAt,
        });
    } catch (err) {
        console.error('profile error:', err);
        res.status(500).json({
            error: 'profile failed',
            details: err?.message || 'Unknown error',
        });
    }
});

/**
 * GET /api/user/generate-nonce
 * Создаёт Telegram link session для текущего пользователя
 */
router.get('/generate-nonce', authWallet_1.authenticateWallet, async (req, res) => {
    try {
        const wallet = req.user.walletAddress;

        const user = await db_1.default.user.findUnique({
            where: { walletAddress: wallet },
        });

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

        const nonce = generateSessionToken();
        const expiresAt = addMinutes(new Date(), 10);
        const botUsername = process.env.TG_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || 'GenesisProtocol_Bot';

        await db_1.default.telegramLinkSession.create({
            data: {
                token: nonce,
                type: 'TELEGRAM_LINK',
                status: 'PENDING',
                userId: user.id,
                walletAddress: user.walletAddress,
                expiresAt,
            },
        });

        const telegramLink = `https://t.me/${botUsername}/app?startapp=${nonce}`;

        res.json({
            nonce,
            expiresAt: expiresAt.toISOString(),
            telegramLink,
        });
    } catch (err) {
        console.error('generate-nonce error:', err);
        res.status(500).json({
            error: 'generate-nonce failed',
            details: err?.message || 'Unknown error',
        });
    }
});

/**
 * POST /api/user/generate-nonce-by-wallet
 * Создаёт Telegram link session по walletAddress
 */
router.post('/generate-nonce-by-wallet', async (req, res) => {
    try {
        const { walletAddress } = req.body;

        if (!walletAddress) {
            res.status(400).json({ error: 'walletAddress required' });
            return;
        }

        const wallet = walletAddress.toLowerCase();

        let user = await db_1.default.user.findUnique({
            where: { walletAddress: wallet },
        });

        if (!user) {
            user = await db_1.default.user.create({
                data: { walletAddress: wallet },
            });
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

        const nonce = generateSessionToken();
        const expiresAt = addMinutes(new Date(), 10);
        const botUsername = process.env.TG_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || 'GenesisProtocol_Bot';

        await db_1.default.telegramLinkSession.create({
            data: {
                token: nonce,
                type: 'TELEGRAM_LINK',
                status: 'PENDING',
                userId: user.id,
                walletAddress: user.walletAddress,
                expiresAt,
            },
        });

        const telegramLink = `https://t.me/${botUsername}/app?startapp=${nonce}`;

        res.json({
            nonce,
            expiresAt: expiresAt.toISOString(),
            telegramLink,
        });
    } catch (err) {
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
            linked: !!(user && user.telegramId),
            telegramUsername: user ? user.telegramUsername || null : null,
        });
    } catch (err) {
        console.error('check-link error:', err);
        res.status(500).json({
            error: 'check-link failed',
            details: err?.message || 'Unknown error',
        });
    }
});

exports.default = router;
//# sourceMappingURL=user.js.map
