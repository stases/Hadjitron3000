// Chromium adds up the connections into a node in an order that changes from run to run, and
// float addition gives the same result in any order only for two terms. So that two renders are
// bit-identical, every summing point in the engine has at most two inputs that are not silent. An AudioParam adds
// its connections to its own value, which counts as one of the two, so a parameter that is not 0 gets one connection.

/** The sum of several nodes, added one at a time. */
export function mix(ctx: BaseAudioContext, nodes: AudioNode[]): AudioNode {
  return nodes.reduce((sum, node) => {
    const g = new GainNode(ctx);
    sum.connect(g);
    node.connect(g);
    return g;
  });
}

export interface Slot {
  input: AudioNode;
  /** Context time from which whatever is connected to `input` is silent. */
  until: number;
}

/** A mixing bus for a changing set of sources: a chain of nodes that each add one source. */
export class Bus {
  private readonly slots: Slot[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly output: AudioNode,
  ) {}

  /** An input that is free from `time` on. It stays taken until the caller sets `until`. */
  take(time: number): Slot {
    let slot = this.slots.find((s) => s.until <= time);
    if (!slot) {
      const input = new GainNode(this.ctx);
      input.connect(this.slots.at(-1)?.input ?? this.output);
      slot = { input, until: Infinity };
      this.slots.push(slot);
    }
    slot.until = Infinity;
    return slot;
  }
}
