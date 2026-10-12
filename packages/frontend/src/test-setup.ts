import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix primitives (select, checkbox) call it on mount.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// jsdom n'a pas non plus matchMedia : largeur simulée de 1280 px par défaut
// (voir src/test-utils/viewport.ts pour la changer dans un test).
import { installMatchMedia } from './test-utils/viewport';
installMatchMedia();
