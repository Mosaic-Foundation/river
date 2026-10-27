// In-memory ActionStores for tests and the stand-in space. A real space keeps these in its
// database (claims and answers for 24 hours, jtis until exp plus 60 s), shared by every instance
// it runs. Each method runs without an await before its write, so in one process a claim is
// atomic, as a database's insert-on-conflict is.
import { FRESH_INTERVAL_S, type ActionStores, type Outcome, type RefClaim } from "./verify.js";

export class MemoryActionStores implements ActionStores {
  /** Claims and final answers by (iss, ref); a claim has no outcome yet. */
  readonly answers = new Map<string, { actKey: string; outcome?: Outcome; until: number }>();
  readonly jtis = new Map<string, number>();
  readonly freshReads = new Map<string, number>();

  async claimRef(iss: string, ref: string, actKey: string, now: number, pendingUntil: number): Promise<RefClaim> {
    const key = JSON.stringify([iss, ref]);
    const held = this.answers.get(key);
    if (held && held.until > now) {
      return held.outcome ? { state: "stored", actKey: held.actKey, outcome: held.outcome } : { state: "pending", actKey: held.actKey };
    }
    this.answers.set(key, { actKey, until: pendingUntil });
    return { state: "claimed" };
  }

  async settleRef(iss: string, ref: string, outcome: Outcome | undefined, until: number): Promise<void> {
    const key = JSON.stringify([iss, ref]);
    const held = this.answers.get(key);
    if (!outcome) {
      this.answers.delete(key);
      return;
    }
    this.answers.set(key, { actKey: held?.actKey ?? "", outcome, until });
  }

  async useJti(jti: string, until: number, now: number): Promise<boolean> {
    const held = this.jtis.get(jti);
    if (held !== undefined && held > now) return false;
    this.jtis.set(jti, until);
    return true;
  }

  async allowFreshRead(did: string, now: number): Promise<boolean> {
    const previous = this.freshReads.get(did);
    if (previous !== undefined && now - previous < FRESH_INTERVAL_S) return false;
    this.freshReads.set(did, now);
    return true;
  }
}
