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
export declare function validateTelegramInitData(initDataRaw: string, botToken: string): TelegramUser;
//# sourceMappingURL=validateTelegram.d.ts.map