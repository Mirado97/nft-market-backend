import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { Readable } from 'stream';
import prisma from '../utils/db';
import { validateTelegramInitData } from '../utils/validateTelegram';
import { authenticateWallet, AuthRequest } from '../middleware/authWallet';

const router = Router();
const BOT_TOKEN = () => process.env.BOT_TOKEN!;

// ─── POST /api/telegram/link ──────────────────────────────────────────────────
// Привязывает Telegram ID к кошельку через nonce
router.post('/link', async (req: Request, res: Response) => {
    const { initData, startParam } = req.body;

    if (!initData || !startParam) {
        res.status(400).json({ error: 'initData and startParam required' });
        return;
    }

    try {
        // 1. Валидация подписи Telegram
        const tgUser = validateTelegramInitData(initData, BOT_TOKEN());

        // 2. Поиск по nonce
        const user = await prisma.user.findUnique({ where: { linkNonce: startParam } });
        if (!user) {
            res.status(404).json({ error: 'Link code not found' });
            return;
        }
        if (user.linkNonceExpiry && user.linkNonceExpiry < new Date()) {
            res.status(410).json({ error: 'Link code expired. Generate a new one on the website.' });
            return;
        }

        // 3. Один TG = один кошелёк
        const existingLink = await prisma.user.findUnique({
            where: { telegramId: BigInt(tgUser.id) },
        });
        if (existingLink && existingLink.id !== user.id) {
            res.status(409).json({ error: 'This Telegram account is already linked to another wallet' });
            return;
        }

        // 4. Привязка
        await prisma.user.update({
            where: { id: user.id },
            data: {
                telegramId: BigInt(tgUser.id),
                telegramUsername: tgUser.username || null,
                telegramLinkedAt: new Date(),
                linkNonce: null,
                linkNonceExpiry: null,
            },
        });

        res.json({
            success: true,
            walletAddress: user.walletAddress,
            message: 'Telegram successfully linked!',
        });
    } catch (err: any) {
        console.error('Telegram link error:', err.message);
        res.status(401).json({ error: err.message });
    }
});

// ─── POST /api/telegram/unlink ────────────────────────────────────────────────
// Отвязывает Telegram от кошелька
router.post('/unlink', authenticateWallet, async (req: AuthRequest, res: Response) => {
    const wallet = req.user!.walletAddress;

    await prisma.user.update({
        where: { walletAddress: wallet },
        data: {
            telegramId: null,
            telegramUsername: null,
            telegramLinkedAt: null,
        },
    });

    res.json({ success: true, message: 'Telegram unlinked' });
});

// ─── POST /api/telegram/create-nft ───────────────────────────────────────────
// Создаёт NFT из base64-картинки, присланной из Telegram Mini App
router.post('/create-nft', async (req: Request, res: Response) => {
    const { initData, base64Image } = req.body;

    // Проверка размера (примерно 10MB base64 ≈ 13.7MB строки)
    if (!base64Image || base64Image.length > 14 * 1024 * 1024) {
        res.status(400).json({ error: 'Image missing or too large (max 10MB)' });
        return;
    }

    try {
        // 1. Валидация Telegram
        const tgUser = validateTelegramInitData(initData, BOT_TOKEN());

        // 2. Находим привязанный кошелёк
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(tgUser.id) },
        });
        if (!user) {
            res.status(403).json({ error: 'Wallet not linked. Link it on the website first.' });
            return;
        }

        // 3. PENDING запись
        const nft = await prisma.nft.create({
            data: { ownerId: user.id, status: 'PENDING' },
        });

        // 4. Отвечаем сразу — минт пойдёт в фоне
        res.json({ success: true, nftId: nft.id, status: 'PENDING' });

        // 5. Фоновый минт
        mintInBackground(nft.id, user.walletAddress, base64Image, tgUser.username || String(tgUser.id));
    } catch (err: any) {
        console.error('Create NFT error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/telegram/nft/:id/status ─────────────────────────────────────────
// Статус минта NFT (для поллинга из Mini App)
router.get('/nft/:id/status', async (req: Request, res: Response) => {
    const nft = await prisma.nft.findUnique({ where: { id: req.params.id as string } });
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

// ─── Background minting ──────────────────────────────────────────────────────
async function mintInBackground(
    nftId: string,
    walletAddress: string,
    base64Image: string,
    creatorName: string
) {
    try {
        await prisma.nft.update({ where: { id: nftId }, data: { status: 'MINTING' } });

        // 1. Base64 → Buffer
        const imageBuffer = Buffer.from(
            base64Image.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );

        // 2. Upload image to IPFS (Pinata)
        let ipfsImageUri = '';
        let ipfsMetaUri = '';

        if (process.env.PINATA_API_KEY && process.env.PINATA_API_KEY !== 'your-pinata-api-key') {
            const pinataSDK = require('@pinata/sdk');
            const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET);

            const stream = Readable.from(imageBuffer);
            (stream as any).path = `nft_${nftId}.png`;

            const imgResult = await pinata.pinFileToIPFS(stream, {
                pinataMetadata: { name: `genesis-nft-image-${nftId}` },
            });
            ipfsImageUri = `ipfs://${imgResult.IpfsHash}`;

            // 3. Upload metadata to IPFS
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
            // DEV mode: пропускаем IPFS, используем placeholder
            console.warn('[DEV] Skipping IPFS upload — PINATA_API_KEY not configured');
            ipfsImageUri = `ipfs://dev-placeholder-image-${nftId}`;
            ipfsMetaUri = `ipfs://dev-placeholder-meta-${nftId}`;
        }

        // 4. Mint on blockchain
        let txHash = '';
        let tokenId: number | null = null;

        if (
            process.env.MINTER_PRIVATE_KEY &&
            process.env.MINTER_PRIVATE_KEY !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            const signer = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
            const contract = new ethers.Contract(
                process.env.NFT_CONTRACT!,
                ['function safeMint(address to, string memory uri) public returns (uint256)'],
                signer
            );

            const tx = await contract.safeMint(walletAddress, ipfsMetaUri);
            const receipt = await tx.wait();
            txHash = tx.hash;

            // Извлекаем tokenId из Transfer event
            const transferLog = receipt.logs.find((log: any) => {
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

        // 5. Update DB
        await prisma.nft.update({
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
        await prisma.nft.update({
            where: { id: nftId },
            data: { status: 'FAILED' },
        });
    }
}

export default router;
