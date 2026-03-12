import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    user?: {
        walletAddress: string;
    };
}
/**
 * Middleware: проверяет JWT-токен из заголовка Authorization: Bearer <token>
 * и добавляет req.user.walletAddress
 */
export declare function authenticateWallet(req: AuthRequest, res: Response, next: NextFunction): void;
//# sourceMappingURL=authWallet.d.ts.map