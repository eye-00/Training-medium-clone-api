export function toAvatarUrl(
  attachmentId: string | null,
): string | null {
  if (!attachmentId) {
    return null;
  }

  return `/api/avatars/${attachmentId}`;
}
