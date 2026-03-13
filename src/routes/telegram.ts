import { Router, Request, Response, NextFunction } from 'express'
import { ethers } from 'ethers'
import { Readable } from 'stream'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../utils/db'
import { validateTelegramInitData } from '../utils/validateTelegram'

const router = Router()

const BOT_TOKEN = () => process.env.BOT_TOKEN || ''
const JWT_SECRET = () => process.env.JWT_SECRET || ''

interface JwtPayload {
    userId: string
    walletAddress?: string
}

function getBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null
    return authHeader.slice(7)
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const token = getBearerToken(req)
        if (!token) { res.status(401).json({ error: 'Authorization token required' }); return }
        const decoded = jwt.verify(token, JWT_SECRET()) as JwtPayload
        const user = await db.user.findUnique({ where: { id: decoded.userId } })
        if (!user) { res.status(401).json({ error: 'User not found' }); return }
        ;(req as any).auth = { userId: user.id, walletAddress: user.walletAddress }
        next()
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' })
    }
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex')
}

function addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000)
}

// POST /api/telegram/session/create
router.post('/session/create', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId: string = (req as any).auth.userId
        const walletAddress: string | null = (req as any).auth.walletAddress || null
        const token = generateSessionToken()
        const expiresAt = addMinutes(new Date(), 10)

        const session = await db.telegramLinkSession.create({
            data: { token, type: 'TELEGRAM_LINK', status: 'PENDING', userId, walletAddress, expiresAt },
        })

        res.json({
            success: true,
            token: session.token,
            expiresAt: session.expiresAt,
            deepLink: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${session.token}`,
        })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// GET /api/telegram/session/:token
router.get('/session/:token', async (req: Request, res: Response) => {
    try {
        const sessionToken = String(req.params['token'])

        const session = await db.telegramLinkSession.findUnique({
            where: { token: sessionToken },
        })

        if (!session) { res.status(404).json({ error: 'Session not found' }); return }

        let linkedUser = null
        if (session.userId) {
            linkedUser = await db.user.findUnique({ where: { id: session.userId } })
        }

        const expired = session.expiresAt < new Date()
        if (expired && session.status === 'PENDING') {
            await db.telegramLinkSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } })
        }

        res.json({
            success: true,
            token: session.token,
            type: session.type,
            status: expired && session.status === 'PENDING' ? 'EXPIRED' : session.status,
            expiresAt: session.expiresAt,
            confirmedAt: session.confirmedAt,
            consumedAt: session.consumedAt,
            walletAddress: session.walletAddress,
            telegramId: session.telegramId ? session.telegramId.toString() : null,
            telegramUsername: session.telegramUsername || null,
            user: linkedUser ? {
                id: linkedUser.id,
                walletAddress: linkedUser.walletAddress,
                telegramId: linkedUser.telegramId ? linkedUser.telegramId.toString() : null,
                telegramUsername: linkedUser.telegramUsername,
                telegramLinkedAt: linkedUser.telegramLinkedAt,
            } : null,
        })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// POST /api/telegram/link
router.post('/link', async (req: Request, res: Response) => {
    const { initData, startParam } = req.body

    if (!initData || !startParam) {
        res.status(400).json({ error: 'initData and startParam required' }); return
    }

    try {
        const tgUser = validateTelegramInitData(initData, BOT_TOKEN())

        const session = await db.telegramLinkSession.findUnique({
            where: { token: String(startParam) },
        })

        if (!session) { res.status(404).json({ error: 'Link session not found' }); return }
        if (session.type !== 'TELEGRAM_LINK') { res.status(400).json({ error: 'Invalid session type' }); return }
        if (session.status !== 'PENDING') { res.status(409).json({ error: `Session is already ${session.status.toLowerCase()}` }); return }

        if (session.expiresAt < new Date()) {
            await db.telegramLinkSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } })
            res.status(410).json({ error: 'Link session expired. Generate a new one.' }); return
        }

        const existingTelegramUser = await db.user.findUnique({ where: { telegramId: BigInt(tgUser.id) } })
        if (existingTelegramUser && existingTelegramUser.id !== session.userId) {
            res.status(409).json({ error: 'This Telegram account is already linked to another user' }); return
        }

        if (!session.userId) { res.status(400).json({ error: 'Session has no target user' }); return }

        const updatedUser = await db.user.update({
            where: { id: session.userId },
            data: {
                telegramId: BigInt(tgUser.id),
                telegramUsername: tgUser.username || null,
                telegramLinkedAt: new Date(),
            },
        })

        await db.telegramLinkSession.update({
            where: { id: session.id },
            data: {
                telegramId: BigInt(tgUser.id),
                telegramUsername: tgUser.username || null,
                confirmedAt: new Date(),
                consumedAt: new Date(),
                status: 'CONSUMED',
            },
        })

        res.json({
            success: true,
            message: 'Telegram successfully linked',
            user: {
                id: updatedUser.id,
                walletAddress: updatedUser.walletAddress,
                telegramId: updatedUser.telegramId ? updatedUser.telegramId.toString() : null,
                telegramUsername: updatedUser.telegramUsername,
                telegramLinkedAt: updatedUser.telegramLinkedAt,
            },
        })
    } catch (err: any) {
        res.status(401).json({ error: err.message })
    }
})

// POST /api/telegram/unlink
router.post('/unlink', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = await db.user.findUnique({ where: { id: (req as any).auth.userId } })
        if (!user) { res.status(404).json({ error: 'User not found' }); return }

        await db.user.update({
            where: { id: user.id },
            data: { telegramId: null, telegramUsername: null, telegramLinkedAt: null },
        })

        res.json({ success: true, message: 'Telegram unlinked' })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// POST /api/telegram/create-nft
router.post('/create-nft', async (req: Request, res: Response) => {
    const { initData, base64Image } = req.body

    if (!base64Image || base64Image.length > 14 * 1024 * 1024) {
        res.status(400).json({ error: 'Image missing or too large (max 10MB)' }); return
    }

    try {
        const tgUser = validateTelegramInitData(initData, BOT_TOKEN())

        const user = await db.user.findUnique({ where: { telegramId: BigInt(tgUser.id) } })
        if (!user) { res.status(403).json({ error: 'Wallet not linked. Link it on the website first.' }); return }
        if (!user.walletAddress) { res.status(403).json({ error: 'No wallet connected for this user.' }); return }

        const nft = await db.nft.create({ data: { ownerId: user.id, status: 'PENDING' } })
        res.json({ success: true, nftId: nft.id, status: 'PENDING' })

        void mintInBackground(nft.id, user.walletAddress, base64Image, tgUser.username || String(tgUser.id))
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// GET /api/telegram/nft/:id/status
router.get('/nft/:id/status', async (req: Request, res: Response) => {
    const nft = await db.nft.findUnique({ where: { id: String(req.params['id']) } })
    if (!nft) { res.status(404).json({ error: 'NFT not found' }); return }

    res.json({
        id: nft.id,
        status: nft.status,
        tokenId: nft.tokenId,
        txHash: nft.txHash,
        ipfsImageUri: nft.ipfsImageUri,
        ipfsMetaUri: nft.ipfsMetaUri,
    })
})

async function mintInBackground(nftId: string, walletAddress: string, base64Image: string, creatorName: string) {
    try {
        await db.nft.update({ where: { id: nftId }, data: { status: 'MINTING' } })

        const imageBuffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        let ipfsImageUri = ''
        let ipfsMetaUri = ''

        if (process.env.PINATA_API_KEY && process.env.PINATA_API_KEY !== 'your-pinata-api-key') {
            const pinataSDK = require('@pinata/sdk')
            const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET)
            const stream = Readable.from(imageBuffer) as Readable & { path?: string }
            stream.path = `nft_${nftId}.png`
            const imgResult = await pinata.pinFileToIPFS(stream, { pinataMetadata: { name: `genesis-nft-image-${nftId}` } })
            ipfsImageUri = `ipfs://${imgResult.IpfsHash}`
            const metadata = {
                name: `Genesis NFT #${nftId.slice(-6)}`,
                description: `Created by ${creatorName} via Telegram Mini App`,
                image: ipfsImageUri,
                attributes: [
                    { trait_type: 'Creator', value: creatorName },
                    { trait_type: 'Platform', value: 'Telegram Mini App' },
                    { trait_type: 'Created', value: new Date().toISOString() },
                ],
            }
            const metaResult = await pinata.pinJSONToIPFS(metadata, { pinataMetadata: { name: `genesis-nft-meta-${nftId}` } })
            ipfsMetaUri = `ipfs://${metaResult.IpfsHash}`
        } else {
            ipfsImageUri = `ipfs://dev-placeholder-image-${nftId}`
            ipfsMetaUri = `ipfs://dev-placeholder-meta-${nftId}`
        }

        let txHash = ''
        let tokenId: number | null = null

        if (process.env.MINTER_PRIVATE_KEY && process.env.MINTER_PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
            const signer = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider)
            const contract = new ethers.Contract(
                process.env.NFT_CONTRACT as string,
                ['function safeMint(address to, string memory uri) public returns (uint256)'],
                signer
            )
            const tx = await contract.safeMint(walletAddress, ipfsMetaUri)
            const receipt = await tx.wait()
            txHash = tx.hash
            const transferLog = receipt.logs.find((log: any) => {
                try { return contract.interface.parseLog(log)?.name === 'Transfer' } catch { return false }
            })
            if (transferLog) {
                const parsed = contract.interface.parseLog(transferLog)
                tokenId = Number(parsed?.args?.tokenId)
            }
        } else {
            txHash = `0xdev_${nftId}`
            tokenId = Math.floor(Math.random() * 10000)
        }

        await db.nft.update({ where: { id: nftId }, data: { ipfsImageUri, ipfsMetaUri, txHash, tokenId, status: 'MINTED' } })
    } catch (err) {
        console.error(`Mint failed for NFT ${nftId}:`, err)
        await db.nft.update({ where: { id: nftId }, data: { status: 'FAILED' } })
    }
}

export default router
