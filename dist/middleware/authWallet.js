"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateWallet = authenticateWallet;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * Middleware: проверяет JWT-токен из заголовка Authorization: Bearer <token>
 * и добавляет req.user.walletAddress
 */
function authenticateWallet(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        res.status(401).json({ error: 'Authorization token required' });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = { walletAddress: payload.walletAddress.toLowerCase() };
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
//# sourceMappingURL=authWallet.js.map