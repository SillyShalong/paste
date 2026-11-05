import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSelection } from '../src/lib/navigation.mjs';

test('left and right move through the history without wrapping', () => {
  assert.equal(moveSelection(2, -1, 5), 1);
  assert.equal(moveSelection(2, 1, 5), 3);
  assert.equal(moveSelection(0, -1, 5), 0);
  assert.equal(moveSelection(4, 1, 5), 4);
});

test('selection remains valid for an empty or shortened history', () => {
  assert.equal(moveSelection(0, 1, 0), 0);
  assert.equal(moveSelection(9, -1, 3), 2);
});
