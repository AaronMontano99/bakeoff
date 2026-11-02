export function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
