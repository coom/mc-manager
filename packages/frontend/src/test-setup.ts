import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix primitives (select, checkbox) call it on mount.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
