/** Re-exported separately to avoid a circular import between constants and cf. */
export const CF_RANK_COLORS: Record<string, string> = {
  newbie: "text-gray-400",
  pupil: "text-green-500",
  specialist: "text-cyan-400",
  expert: "text-blue-400",
  "candidate master": "text-violet-400",
  master: "text-orange-400",
  "international master": "text-orange-400",
  grandmaster: "text-red-400",
  "international grandmaster": "text-red-400",
  "legendary grandmaster": "text-red-500",
};

export function cfProfileUrlSafe(handle: string): string {
  return `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
}
