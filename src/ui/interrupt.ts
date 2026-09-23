/**
 * Two ways out of a step, and they mean different things.
 *
 * `Interrupted` is Ctrl-C: back out of whatever is happening and let the caller
 * decide where to go. It is not fatal — the runner catches it and opens the
 * stage navigator, so a mistyped answer or a suggestion pass you have changed
 * your mind about costs you a keystroke rather than the whole run.
 *
 * `Cancelled` is you choosing to stop. Only the navigator raises it, and it
 * ends the run.
 */

export class Interrupted extends Error {
  constructor() {
    super('interrupted');
    this.name = 'Interrupted';
  }
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}
