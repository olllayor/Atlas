import assert from 'node:assert/strict';
import test from 'node:test';

import { formatHomeRelativePath } from '../src/renderer/components/sidebarViewModel';

test('collapses a macOS home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('/Users/ada/Code/Projects/Atlas'), '~/Code/Projects/Atlas');
});

test('collapses a Linux home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('/home/ada/src/atlas'), '~/src/atlas');
});

test('collapses a Windows home prefix to ~', () => {
  assert.equal(formatHomeRelativePath('C:\\Users\\ada\\src\\atlas'), '~\\src\\atlas');
});

test('renders the home directory itself as ~', () => {
  assert.equal(formatHomeRelativePath('/Users/ada'), '~');
});

test('leaves roots outside a home directory untouched', () => {
  assert.equal(formatHomeRelativePath('/opt/src/atlas'), '/opt/src/atlas');
  assert.equal(formatHomeRelativePath('/Volumes/Work/atlas'), '/Volumes/Work/atlas');
});

test('does not collapse a path that merely starts with the same letters', () => {
  assert.equal(formatHomeRelativePath('/UsersData/atlas'), '/UsersData/atlas');
});
