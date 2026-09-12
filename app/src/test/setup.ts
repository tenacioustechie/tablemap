/**
 * Vitest setup, run before every test file. Gives every environment an
 * in-memory IndexedDB so persistence code works under jsdom and node alike.
 * Data does not survive across files (each file gets fresh globals);
 * persistence tests still use a uniquely named database per test.
 */
import "fake-indexeddb/auto";
