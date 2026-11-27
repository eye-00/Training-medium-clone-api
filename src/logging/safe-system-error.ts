const SAFE_SYSTEM_ERROR_CODES = new Set([
    'EACCES', 'EPERM', 'ENOENT', 'EIO', 'ENOSPC', 'EMFILE', 'ENFILE',
    'EBUSY', 'EROFS', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
    'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
    'ECONNABORTED',
]);

/** Return only known system error codes, never arbitrary dependency text. */
export function safeSystemErrorCode(error: unknown): string | undefined {
    try {
        if (typeof error !== 'object' || error === null || !('code' in error)) {
            return undefined;
        }
        const code = error.code;
        return typeof code === 'string' && SAFE_SYSTEM_ERROR_CODES.has(code)
            ? code
            : undefined;
    } catch {
        return undefined;
    }
}
