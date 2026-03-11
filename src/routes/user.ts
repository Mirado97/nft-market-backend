import { Router, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/db';
import { authenticateWallet, AuthRequest } from '../middleware/authWallet';

const router = Router();

/**
 * GET /api/user/profile
 * Возвращает профиль текущего пользователя (статус привязки Telegram)
 */
router.get('/profile', authenticateWallet, async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
        where: { walletAddress: req.user!.walletAddress },
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
router.get('/generate-nonce', authenticateWallet, async (req: AuthRequest, res: Response) => {
    const wallet = req.user!.walletAddress;

    const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
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

    const nonce = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
        where: { walletAddress: wallet },
        data: { linkNonce: nonce, linkNonceExpiry: expiresAt },
    });

    const botUsername = process.env.TG_BOT_USERNAME || 'GenesisProtocol_Bot';
    const telegramLink = `https://t.me/${botUsername}/app?startapp=${nonce}`;

    res.json({ nonce, expiresAt: expiresAt.toISOString(), telegramLink });
});

export default router;
