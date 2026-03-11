import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: {
        walletAddress: string;
    };
}

/**
 * Middleware: проверяет JWT-токен из заголовка Authorization: Bearer <token>
 * и добавляет req.user.walletAddress
 */
export function authenticateWallet(req: AuthRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        res.status(401).json({ error: 'Authorization token required' });
        return;
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as { walletAddress: string };
        req.user = { walletAddress: payload.walletAddress.toLowerCase() };
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
