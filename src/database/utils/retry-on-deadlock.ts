import { QueryFailedError } from 'typeorm';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 30;
const JITTER_MS = 30;

type MySqlDriverError = {
    code?: string;
    errno?: number;
};

function isMySqlDeadlock(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
        return false;
    }

    const driverError =
        error.driverError as MySqlDriverError | null;

    return (
        driverError?.code === 'ER_LOCK_DEADLOCK' ||
        driverError?.errno === 1213
    );
}

/**
 * Retries an operation when MySQL reports a deadlock.
 *
 * The operation must execute the entire transaction
 * so that every retry starts a new transaction.
 */
export async function retryOnDeadlock<T>(
    operation: () => Promise<T>,
): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            if (
                !isMySqlDeadlock(error) ||
                attempt >= MAX_ATTEMPTS
            ) {
                throw error;
            }

            const delayMs =
                attempt * BASE_DELAY_MS +
                Math.floor(Math.random() * JITTER_MS);

            await new Promise<void>((resolve) => {
                setTimeout(resolve, delayMs);
            });
        }
    }
}
