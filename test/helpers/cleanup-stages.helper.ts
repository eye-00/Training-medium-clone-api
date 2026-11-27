/** Run independent cleanup stages and preserve every failure for the caller. */
export async function runCleanupStages(
    stages: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
    const errors: unknown[] = [];
    for (const stage of stages) {
        try {
            await stage();
        } catch (error: unknown) {
            errors.push(error);
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Fixture cleanup stages failed');
    }
}
