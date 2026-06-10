/** Deterministic seeded RNG (mulberry32) for reproducible sample data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(lo = 0, hi = 1): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.float(lo, hi + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
  /** Approximately normal via sum of uniforms. */
  gauss(meanV = 0, stdV = 1): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return meanV + ((s - 3) / Math.sqrt(0.5)) * stdV * 0.7071;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  poissonish(lambda: number): number {
    // cheap approximation adequate for synthetic alarm counts
    if (lambda <= 0) return 0;
    const v = this.gauss(lambda, Math.sqrt(lambda));
    return Math.max(0, Math.round(v));
  }
}
