import { Router, Request, Response } from 'express';
import { SiweMessage } from 'siwe';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../utils/db';

const router = Router();

// Хранилище nonce (в продакшене — Redis)
const nonceStore = new Map<string, { nonce: string; createdAt: number }>();

/**
 * GET /api/auth/nonce
 * Генерирует nonce для SiWE
 */
router.get('/nonce', (_req: Request, res: Response) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    // Сохраняем nonce с таймстампом (5 минут жизни)
    nonceStore.set(nonce, { nonce, createdAt: Date.now() });
    res.json({ nonce });
});

/**
 * POST /api/auth/wallet-login
 * Sign-In with Ethereum → JWT
 * Body: { message: string, signature: string }
 */
router.post('/wallet-login', async (req: Request, res: Response) => {
    const { message, signature } = req.body;

    if (!message || !signature) {
        res.status(400).json({ error: 'message and signature required' });
        return;
    }

    try {
        const siweMessage = new SiweMessage(message);
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
        let user = await prisma.user.findUnique({ where: { walletAddress } });
        if (!user) {
            user = await prisma.user.create({ data: { walletAddress } });
        }

        // Генерируем JWT (24 часа)
        const token = jwt.sign(
            { walletAddress, userId: user.id },
            process.env.JWT_SECRET!,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                walletAddress: user.walletAddress,
                telegramId: user.telegramId?.toString() || null,
                telegramUsername: user.telegramUsername,
            }
        });
    } catch (err: any) {
        console.error('SiWE verification failed:', err.message);
        res.status(401).json({ error: 'Signature verification failed' });
    }
});

export default router;
