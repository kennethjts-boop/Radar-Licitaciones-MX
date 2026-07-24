export function parseAdminUserIds(rawIds = ""): Set<string> {
  return new Set(
    rawIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function adminCommandsEnabled(rawIds = ""): boolean {
  return parseAdminUserIds(rawIds).size > 0;
}

export function isAuthorizedAdmin(
  userId: number | undefined,
  rawIds = "",
): boolean {
  if (userId === undefined) return false;
  return parseAdminUserIds(rawIds).has(String(userId));
}
