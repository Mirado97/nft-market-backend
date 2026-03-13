"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });

const express_1 = require("express");
const ethers_1 = require("ethers");
const stream_1 = require("stream");
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../utils/db"));
const validateTelegram_1 = require("../utils/validateTelegram");

const router = (0, express_1.Router)();

const BOT_TOKEN = () => process.env.BOT_TOKEN || '';
const JWT_SECRET = () => process.env.JWT_SECRET || '';

function getBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.slice(7);
}

async function requireAuth(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            res.status(401).json({ error: 'Authorization token required' });
            return;
        }

        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET());

        const user = await db_1.default.user.findUnique({
            where: { id: decoded.userId },
        });

        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        req.auth = {
            userId: user.id,
            walletAddress: user.walletAddress,
        };

        next();
    } catch (err) {
        console.error('Auth middleware error:', err.message);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function generateSessionToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

// ─── POST /api/telegram/session/create ──────────────────────────────────────
router.post('/session/create', requireAuth, async (req, res) => {
    try {
        const userId = req.auth.userId;
        const walletAddress = req.auth.walletAddress || null;

        const token = generateSessionToken();
        const expiresAt = addMinutes(new Date(), 10);

        const session = await db_1.default.telegramLinkSession.create({
            data: {
                token,
                type: 'TELEGRAM_LINK',
                status: 'PENDING',
                userId,
                walletAddress,
                expiresAt,
            },
        });

        res.json({
            success: true,
            token: session.token,
            expiresAt: session.expiresAt,
            deepLink: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${session.token}`,
        });
    } catch (err) {
        console.error('Create telegram session error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/telegram/session/:token ───────────────────────────────────────
router.get('/session/:token', async (req, res) => {
    try {
        const session = await db_1.default.telegramLinkSession.findUnique({
            where: { token: req.params.token },
            include: { user: true },
        });

        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        const expired = session.expiresAt < new Date();

        if (expired && session.status === 'PENDING') {
            await db_1.default.telegramLinkSession.update({
                where: { id: session.id },
                data: { status: 'EXPIRED' },
            });
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
            user: session.user
                ? {
                    id: session.user.id,
                    walletAddress: session.user.walletAddress,
                    telegramId: session.user.telegramId ? session.user.telegramId.toString() : null,
                    telegramUsername: session.user.telegramUsername,
                    telegramLinkedAt: session.user.telegramLinkedAt,
                }
                : null,
        });
    } catch (err) {
        console.error('Get telegram session error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/telegram/link ────────────────────────────────────────────────
router.post('/link', async (req, res) => {
    const { initData, startParam } = req.body;

    if (!initData || !startParam) {
        res.status(400).json({ error: 'initData and startParam required' });
        return;
    }

    try {
        const tgUser = (0, validateTelegram_1.validateTelegramInitData)(initData, BOT_TOKEN());

        const session = await db_1.default.telegramLinkSession.findUnique({
            where: { token: startParam },
            include: { user: true },
        });

        if (!session) {
            res.status(404).json({ error: 'Link session not found' });
            return;
        }

        if (session.type !== 'TELEGRAM_LINK') {
            res.status(400).json({ error: 'Invalid session type' });
            return;
        }

        if (session.status !== 'PENDING') {
            res.status(409).json({ error: `Session is already ${session.status.toLowerCase()}` });
            return;
        }

        if (session.expiresAt < new Date()) {
            await db_1.default.telegramLinkSession.update({
                where: { id: session.id },
                data: { status: 'EXPIRED' },
            });

            res.status(410).json({ error: 'Link session expired. Generate a new one on the website.' });
            return;
        }

        const existingTelegramUser = await db_1.default.user.findUnique({
            where: { telegramId: BigInt(tgUser.id) },
        });

        if (existingTelegramUser && existingTelegramUser.id !== session.userId) {
            res.status(409).json({ error: 'This Telegram account is already linked to another user' });
            return;
        }

        if (!session.userId) {
            res.status(400).json({ error: 'Session has no target user' });
            return;
        }

        const updatedUser = await db_1.default.user.update({
            where: { id: session.userId },
            data: {
                telegramId: BigInt(tgUser.id),
                telegramUsername: tgUser.username || null,
                telegramLinkedAt: new Date(),
            },
        });

        await db_1.default.telegramLinkSession.update({
            where: { id: session.id },
            data: {
                telegramId: BigInt(tgUser.id),
                telegramUsername: tgUser.username || null,
                confirmedAt: new Date(),
                consumedAt: new Date(),
                status: 'CONSUMED',
            },
        });

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
        });
    } catch (err) {
        console.error('Telegram link error:', err.message);
        res.status(401).json({ error: err.message });
    }
});

// ─── POST /api/telegram/unlink ──────────────────────────────────────────────
router.post('/unlink', requireAuth, async (req, res) => {
    try {
        const user = await db_1.default.user.findUnique({
            where: { id: req.auth.userId },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        await db_1.default.user.update({
            where: { id: user.id },
            data: {
                telegramId: null,
                telegramUsername: null,
                telegramLinkedAt: null,
            },
        });

        res.json({ success: true, message: 'Telegram unlinked' });
    } catch (err) {
        console.error('Telegram unlink error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/telegram/create-nft ──────────────────────────────────────────
router.post('/create-nft', async (req, res) => {
    const { initData, base64Image } = req.body;

    if (!base64Image || base64Image.length > 14 * 1024 * 1024) {
        res.status(400).json({ error: 'Image missing or too large (max 10MB)' });
        return;
    }

    try {
        const tgUser = (0, validateTelegram_1.validateTelegramInitData)(initData, BOT_TOKEN());

        const user = await db_1.default.user.findUnique({
            where: { telegramId: BigInt(tgUser.id) },
        });

        if (!user) {
            res.status(403).json({ error: 'Wallet not linked. Link it on the website first.' });
            return;
        }

        if (!user.walletAddress) {
            res.status(403).json({ error: 'No wallet connected for this user.' });
            return;
        }

        const nft = await db_1.default.nft.create({
            data: { ownerId: user.id, status: 'PENDING' },
        });

        res.json({ success: true, nftId: nft.id, status: 'PENDING' });

        mintInBackground(
            nft.id,
            user.walletAddress,
            base64Image,
            tgUser.username || String(tgUser.id)
        );
    } catch (err) {
        console.error('Create NFT error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/telegram/nft/:id/status ───────────────────────────────────────
router.get('/nft/:id/status', async (req, res) => {
    const nft = await db_1.default.nft.findUnique({ where: { id: req.params.id } });

    if (!nft) {
        res.status(404).json({ error: 'NFT not found' });
        return;
    }

    res.json({
        id: nft.id,
        status: nft.status,
        tokenId: nft.tokenId,
        txHash: nft.txHash,
        ipfsImageUri: nft.ipfsImageUri,
        ipfsMetaUri: nft.ipfsMetaUri,
    });
});

// ─── Background minting ─────────────────────────────────────────────────────
async function mintInBackground(nftId, walletAddress, base64Image, creatorName) {
    try {
        await db_1.default.nft.update({
            where: { id: nftId },
            data: { status: 'MINTING' },
        });

        const imageBuffer = Buffer.from(
            base64Image.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );

        let ipfsImageUri = '';
        let ipfsMetaUri = '';

        if (process.env.PINATA_API_KEY && process.env.PINATA_API_KEY !== 'your-pinata-api-key') {
            const pinataSDK = require('@pinata/sdk');
            const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET);

            const stream = stream_1.Readable.from(imageBuffer);
            stream.path = `nft_${nftId}.png`;

            const imgResult = await pinata.pinFileToIPFS(stream, {
                pinataMetadata: { name: `genesis-nft-image-${nftId}` },
            });

            ipfsImageUri = `ipfs://${imgResult.IpfsHash}`;

            const metadata = {
                name: `Genesis NFT #${nftId.slice(-6)}`,
                description: `Created by ${creatorName} via Telegram Mini App`,
                image: ipfsImageUri,
                attributes: [
                    { trait_type: 'Creator', value: creatorName },
                    { trait_type: 'Platform', value: 'Telegram Mini App' },
                    { trait_type: 'Created', value: new Date().toISOString() },
                ],
            };

            const metaResult = await pinata.pinJSONToIPFS(metadata, {
                pinataMetadata: { name: `genesis-nft-meta-${nftId}` },
            });

            ipfsMetaUri = `ipfs://${metaResult.IpfsHash}`;
        } else {
            console.warn('[DEV] Skipping IPFS upload — PINATA_API_KEY not configured');
            ipfsImageUri = `ipfs://dev-placeholder-image-${nftId}`;
            ipfsMetaUri = `ipfs://dev-placeholder-meta-${nftId}`;
        }

        let txHash = '';
        let tokenId = null;

        if (
            process.env.MINTER_PRIVATE_KEY &&
            process.env.MINTER_PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
            const provider = new ethers_1.ethers.JsonRpcProvider(process.env.RPC_URL);
            const signer = new ethers_1.ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);

            const contract = new ethers_1.ethers.Contract(
                process.env.NFT_CONTRACT,
                ['function safeMint(address to, string memory uri) public returns (uint256)'],
                signer
            );

            const tx = await contract.safeMint(walletAddress, ipfsMetaUri);
            const receipt = await tx.wait();

            txHash = tx.hash;

            const transferLog = receipt.logs.find((log) => {
                try {
                    return contract.interface.parseLog(log)?.name === 'Transfer';
                } catch {
                    return false;
                }
            });

            if (transferLog) {
                const parsed = contract.interface.parseLog(transferLog);
                tokenId = Number(parsed?.args?.tokenId);
            }
        } else {
            console.warn('[DEV] Skipping blockchain mint — MINTER_PRIVATE_KEY not configured');
            txHash = `0xdev_${nftId}`;
            tokenId = Math.floor(Math.random() * 10000);
        }

        await db_1.default.nft.update({
            where: { id: nftId },
            data: {
                ipfsImageUri,
                ipfsMetaUri,
                txHash,
                tokenId,
                status: 'MINTED',
            },
        });

        console.log(`✅ NFT ${nftId} minted: tokenId=${tokenId}, tx=${txHash}`);
    } catch (err) {
        console.error(`❌ Mint failed for NFT ${nftId}:`, err);

        await db_1.default.nft.update({
            where: { id: nftId },
            data: { status: 'FAILED' },
        });
    }
}

exports.default = router;
//# sourceMappingURL=telegram.js.map
