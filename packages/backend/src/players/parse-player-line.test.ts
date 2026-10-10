import { describe, it, expect } from 'vitest';
import { parsePlayerLine, classifyRefusal } from './parse-player-line.js';

describe('parsePlayerLine', () => {
  it('reads the UUID announcement', () => {
    expect(parsePlayerLine('UUID of player Alice_01 is 069a79f4-44e9-4726-a5be-fca90e38aaf5'))
      .toEqual({ type: 'uuid', name: 'Alice_01', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' });
  });
  it('reads a join with an IPv4 and strips the port', () => {
    expect(parsePlayerLine('Alice_01[/203.0.113.9:51234] logged in with entity id 123 at (12.5, 64.0, -8.2)'))
      .toEqual({ type: 'join', name: 'Alice_01', ip: '203.0.113.9' });
  });
  it('reads a join with a long-form IPv6', () => {
    expect(parsePlayerLine('Bob[/0:0:0:0:0:0:0:1:51234] logged in with entity id 5 at (0.0, 64.0, 0.0)'))
      .toEqual({ type: 'join', name: 'Bob', ip: '0:0:0:0:0:0:0:1' });
  });
  it('reads a join with a bracketed IPv6', () => {
    expect(parsePlayerLine('Bob[/[2001:db8::1]:51234] logged in with entity id 5 at (0.0, 64.0, 0.0)'))
      .toEqual({ type: 'join', name: 'Bob', ip: '2001:db8::1' });
  });
  it('reads a join on a log-ips=false server with an empty ip', () => {
    expect(parsePlayerLine('Bob[IP hidden] logged in with entity id 5 at (0.0, 64.0, 0.0)'))
      .toEqual({ type: 'join', name: 'Bob', ip: '' });
  });
  it('reads a refusal on a log-ips=false server with a null ip', () => {
    expect(parsePlayerLine('Disconnecting Mallory (IP hidden): You are banned from this server.'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: null, message: 'You are banned from this server.' });
  });
  it('reads a leave', () => {
    expect(parsePlayerLine('Alice_01 left the game')).toEqual({ type: 'leave', name: 'Alice_01' });
  });
  it('reads lost connection as a leave', () => {
    expect(parsePlayerLine('Alice_01 lost connection: Disconnected')).toEqual({ type: 'leave', name: 'Alice_01' });
  });
  it('reads a refusal in the modern format', () => {
    expect(parsePlayerLine('Disconnecting Mallory (/198.51.100.7:40000): You are not white-listed on this server!'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: '198.51.100.7', message: 'You are not white-listed on this server!' });
  });
  it('reads a refusal in the GameProfile format', () => {
    expect(parsePlayerLine('Disconnecting com.mojang.authlib.GameProfile@1a2b[id=069a79f4-44e9-4726-a5be-fca90e38aaf5,name=Mallory,properties={},legacy=false] (/198.51.100.7:40000): You are banned from this server.'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: '198.51.100.7', message: 'You are banned from this server.' });
  });
  it('reads a GameProfile refusal with name before id', () => {
    expect(parsePlayerLine('Disconnecting com.mojang.authlib.GameProfile@1a2b[name=Mallory,id=069a79f4-44e9-4726-a5be-fca90e38aaf5,properties={},legacy=false] (/198.51.100.7:40000): You are banned from this server.'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: '198.51.100.7', message: 'You are banned from this server.' });
  });
  it('rejects a GameProfile refusal whose name exceeds 16 characters', () => {
    expect(parsePlayerLine('Disconnecting com.mojang.authlib.GameProfile@1a2b[id=069a79f4-44e9-4726-a5be-fca90e38aaf5,name=Abcdefghijklmnopq,properties={},legacy=false] (/198.51.100.7:40000): You are banned from this server.'))
      .toBeNull();
  });
  it('rejects a GameProfile refusal whose name contains an invalid character', () => {
    expect(parsePlayerLine('Disconnecting com.mojang.authlib.GameProfile@1a2b[id=069a79f4-44e9-4726-a5be-fca90e38aaf5,name=Bob-x,properties={},legacy=false] (/198.51.100.7:40000): You are banned from this server.'))
      .toBeNull();
  });
  it('accepts 3- and 16-character names and rejects 17 on the leave form', () => {
    expect(parsePlayerLine('Abc left the game')).toEqual({ type: 'leave', name: 'Abc' });
    expect(parsePlayerLine('Abcdefghijklmnop left the game')).toEqual({ type: 'leave', name: 'Abcdefghijklmnop' });
    expect(parsePlayerLine('Abcdefghijklmnopq left the game')).toBeNull();
  });
  it('ignores chat lines that look like events', () => {
    expect(parsePlayerLine('<Alice_01> Bob left the game')).toBeNull();
    expect(parsePlayerLine('<Alice_01> UUID of player Bob is 069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBeNull();
  });
  it('ignores unrelated lines and invalid names', () => {
    expect(parsePlayerLine('Done (3.2s)! For help, type "help"')).toBeNull();
    expect(parsePlayerLine('Al left the game')).toBeNull();
    expect(parsePlayerLine('a-b[/1.2.3.4:1] logged in with entity id 1 at (0, 0, 0)')).toBeNull();
  });
});

describe('classifyRefusal', () => {
  it.each([
    ['You are not white-listed on this server!', 'not_whitelisted'],
    ['You are banned from this server.', 'banned'],
    ['The server is full!', 'full'],
    ['Failed to verify username!', 'other'],
  ])('%s -> %s', (m, r) => expect(classifyRefusal(m)).toBe(r));
});
