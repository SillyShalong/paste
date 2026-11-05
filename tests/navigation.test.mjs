import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSelection, scrollTarget } from '../src/lib/navigation.mjs';

test('left and right move through the history without wrapping', () => {
  assert.equal(moveSelection(2, -1, 5), 1);
  assert.equal(moveSelection(2, 1, 5), 3);
  assert.equal(moveSelection(0, -1, 5), 0);
  assert.equal(moveSelection(4, 1, 5), 4);
});

test('scroll follows cards equally in either direction and respects bounds', () => {
  assert.equal(scrollTarget(100, 300, 50, 100, 1000), 38);
  assert.equal(scrollTarget(100, 300, 350, 100, 1000), 62 + 100);
  assert.equal(scrollTarget(100, 300, 150, 100, 1000), 100);
  assert.equal(scrollTarget(50, 300, 0, 100, 1000), 0);
  assert.equal(scrollTarget(800, 300, 1100, 200, 1000), 1000);
});

test('selection remains valid for an empty or shortened history', () => {
  assert.equal(moveSelection(0, 1, 0), 0);
  assert.equal(moveSelection(9, -1, 3), 2);
});
