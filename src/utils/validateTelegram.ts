import crypto from 'crypto';

export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

/**
 * Валидирует initData от Telegram Web App.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initDataRaw: string, botToken: string): TelegramUser {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');

    if (!hash) {
        throw new Error('Missing hash in initData');
    }

    params.delete('hash');

    // 1. Сортируем ключи, join через \n
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `${key}=${val}`)
        .join('\n');

    // 2. HMAC-SHA256("WebAppData", botToken) → secretKey
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

    // 3. HMAC-SHA256(secretKey, dataCheckString) → calculatedHash
    const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    // 4. Timing-safe сравнение
    if (!crypto.timingSafeEqual(
        Buffer.from(calculatedHash, 'hex'),
        Buffer.from(hash, 'hex')
    )) {
        throw new Error('Invalid Telegram initData signature');
    }

    // 5. Проверка свежести (max 5 минут)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 300) {
        throw new Error('Telegram initData expired (older than 5 minutes)');
    }

    // 6. Парсим пользователя
    const userRaw = params.get('user');
    if (!userRaw) {
        throw new Error('Missing user in initData');
    }

    return JSON.parse(userRaw) as TelegramUser;
}
