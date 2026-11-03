export {}

declare const self: Worker

// A check that never answers, as a synchronous step past the deadline would be.
self.onmessage = () => {
  for (;;);
}
