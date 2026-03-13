import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import db from '../utils/db'
import { authenticateWallet } from '../middleware/authWallet'

const router = Router()

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex')
}

function addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000)
}

router.get('/profile', authenticateWallet, async (req: Request, res: Response) => {
    try {
        const user = await db.user.findUnique({ where: { walletAddress: (req as any).user.walletAddress } })
        if (!user) { res.status(404).json({ error: 'User not found' }); return }

        res.json({
            id: user.id,
            walletAddress: user.walletAddress,
            telegramId: user.telegramId ? user.telegramId.toString() : null,
            telegramUsername: user.telegramUsername,
            telegramLinkedAt: user.telegramLinkedAt,
        })
    } catch (err: any) {
        res.status(500).json({ error: 'profile failed', details: err?.message })
    }
})

router.get('/generate-nonce', authenticateWallet, async (req: Request, res: Response) => {
    try {
        const wallet = (req as any).user.walletAddress
        const user = await db.user.findUnique({ where: { walletAddress: wallet } })
        if (!user) { res.status(404).json({ error: 'User not found' }); return }

        if (user.telegramId) {
            res.status(400).json({ error: 'Telegram already linked', telegram: { id: user.telegramId.toString(), username: user.telegramUsername } })
            return
        }

        const nonce = generateSessionToken()
        const expiresAt = addMinutes(new Date(), 10)
        const botUsername = process.env.TG_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || 'GenesisProtocol_Bot'

        await db.telegramLinkSession.create({
            data: { token: nonce, type: 'TELEGRAM_LINK', status: 'PENDING', userId: user.id, walletAddress: user.walletAddress, expiresAt },
        })

        res.json({ nonce, expiresAt: expiresAt.toISOString(), telegramLink: `https://t.me/${botUsername}/app?startapp=${nonce}` })
    } catch (err: any) {
        res.status(500).json({ error: 'generate-nonce failed', details: err?.message })
    }
})

router.post('/generate-nonce-by-wallet', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.body
        if (!walletAddress) { res.status(400).json({ error: 'walletAddress required' }); return }

        const wallet = walletAddress.toLowerCase()
        let user = await db.user.findUnique({ where: { walletAddress: wallet } })
        if (!user) { user = await db.user.create({ data: { walletAddress: wallet } }) }

        if (user.telegramId) {
            res.status(400).json({ error: 'Telegram already linked', telegram: { id: user.telegramId.toString(), username: user.telegramUsername } })
            return
        }

        const nonce = generateSessionToken()
        const expiresAt = addMinutes(new Date(), 10)
        const botUsername = process.env.TG_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || 'GenesisProtocol_Bot'

        await db.telegramLinkSession.create({
            data: { token: nonce, type: 'TELEGRAM_LINK', status: 'PENDING', userId: user.id, walletAddress: user.walletAddress, expiresAt },
        })

        res.json({ nonce, expiresAt: expiresAt.toISOString(), telegramLink: `https://t.me/${botUsername}/app?startapp=${nonce}` })
    } catch (err: any) {
        res.status(500).json({ error: 'generate-nonce-by-wallet failed', details: err?.message })
    }
})

router.post('/check-link', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.body
        if (!walletAddress) { res.status(400).json({ error: 'walletAddress required' }); return }

        const user = await db.user.findUnique({ where: { walletAddress: walletAddress.toLowerCase() } })
        res.json({ linked: !!(user && user.telegramId), telegramUsername: user?.telegramUsername || null })
    } catch (err: any) {
        res.status(500).json({ error: 'check-link failed', details: err?.message })
    }
})

export default router
